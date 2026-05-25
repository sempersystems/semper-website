import crypto from "node:crypto";

const MAX_BODY_BYTES = 2048;
const MIN_SUBMIT_MS = 1600;
const MAX_FORM_AGE_MS = 30 * 60 * 1000;
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FORWARD_TIMEOUT_MS = 5000;

const ipBuckets = globalThis.__semperWaitlistIpBuckets ?? new Map();
const ipDailyBuckets = globalThis.__semperWaitlistIpDailyBuckets ?? new Map();
const emailBuckets = globalThis.__semperWaitlistEmailBuckets ?? new Map();
const acceptedEmailCooldowns =
  globalThis.__semperWaitlistAcceptedEmailCooldowns ?? new Map();

globalThis.__semperWaitlistIpBuckets = ipBuckets;
globalThis.__semperWaitlistIpDailyBuckets = ipDailyBuckets;
globalThis.__semperWaitlistEmailBuckets = emailBuckets;
globalThis.__semperWaitlistAcceptedEmailCooldowns = acceptedEmailCooldowns;

class PublicError extends Error {
  constructor(statusCode, code, message, retryAfterSeconds = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export default async function handler(request, response) {
  setBaseHeaders(response);

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(request, response, 405, {
      code: "method_not_allowed",
      message: "Use the waitlist form to join.",
    });
  }

  try {
    enforceSameOrigin(request);

    const payload = parsePayload(
      await readBody(request),
      request.headers["content-type"] ?? "",
    );

    if (isSpamTrap(payload)) {
      return send(request, response, 200, successPayload());
    }

    const email = normalizeEmail(payload.email);
    validateTiming(payload.startedAt);

    const ipKey = hash(getClientIp(request));
    enforceRateLimit(
      ipBuckets,
      ipKey,
      5,
      IP_WINDOW_MS,
      "Too many attempts. Try again in a few minutes.",
    );
    enforceRateLimit(
      ipDailyBuckets,
      ipKey,
      25,
      IP_DAILY_WINDOW_MS,
      "Too many waitlist attempts today. Try again tomorrow.",
    );

    const emailKey = hash(email);
    if (isInCooldown(acceptedEmailCooldowns, emailKey, EMAIL_COOLDOWN_MS)) {
      return send(request, response, 200, successPayload());
    }

    enforceRateLimit(
      emailBuckets,
      emailKey,
      3,
      EMAIL_WINDOW_MS,
      "That email has been submitted too many times today.",
    );

    await forwardSignup({
      event: "waitlist.signup",
      email,
      source: "waitlist-page",
      site: "semper.systems",
      createdAt: new Date().toISOString(),
    });

    acceptedEmailCooldowns.set(emailKey, Date.now());
    pruneCooldowns(acceptedEmailCooldowns, EMAIL_COOLDOWN_MS);

    return send(request, response, 200, successPayload());
  } catch (error) {
    if (error instanceof PublicError) {
      return send(
        request,
        response,
        error.statusCode,
        {
          code: error.code,
          message: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        error.retryAfterSeconds,
      );
    }

    console.error("WAITLIST_ERROR", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return send(request, response, 500, {
      code: "server_error",
      message: "Unable to join the waitlist right now.",
    });
  }
}

function setBaseHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function successPayload() {
  return {
    code: "joined",
    message: "You're on the list. We'll be in touch.",
  };
}

function send(request, response, statusCode, payload, retryAfterSeconds = null) {
  if (retryAfterSeconds) {
    response.setHeader("Retry-After", String(retryAfterSeconds));
  }

  if (wantsHtml(request)) {
    const target = new URLSearchParams();
    if (statusCode >= 200 && statusCode < 300) {
      target.set("joined", "1");
    } else {
      target.set("error", payload.code ?? "error");
    }

    response.statusCode = 303;
    response.setHeader("Location", `/waitlist?${target.toString()}`);
    response.end();
    return;
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function wantsHtml(request) {
  const accept = String(request.headers.accept ?? "");
  return accept.includes("text/html") && !accept.includes("application/json");
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;

    if (size > MAX_BODY_BYTES) {
      throw new PublicError(
        413,
        "payload_too_large",
        "The submitted form is too large.",
      );
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parsePayload(body, contentType) {
  if (!body.trim()) {
    throw new PublicError(400, "empty_request", "Enter a valid email address.");
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch {
      throw new PublicError(400, "bad_json", "Enter a valid email address.");
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body));
  }

  throw new PublicError(415, "unsupported_media_type", "Use the waitlist form to join.");
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  const validEmail =
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) &&
    !email.includes("..");

  if (!validEmail) {
    throw new PublicError(400, "invalid_email", "Enter a valid email address.");
  }

  return email;
}

function validateTiming(startedAt) {
  const started = Number(startedAt);
  const elapsed = Date.now() - started;

  if (!Number.isFinite(started) || elapsed < MIN_SUBMIT_MS) {
    throw new PublicError(
      400,
      "too_fast",
      "Please wait a moment, then try again.",
    );
  }

  if (elapsed > MAX_FORM_AGE_MS) {
    throw new PublicError(400, "form_expired", "Refresh the page and try again.");
  }
}

function isSpamTrap(payload) {
  return String(payload.company ?? "").trim().length > 0;
}

function enforceSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;

  const allowedOrigins = new Set(
    String(process.env.WAITLIST_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  if (host) {
    allowedOrigins.add(`https://${host}`);
    allowedOrigins.add(`http://${host}`);
  }

  if (!allowedOrigins.has(origin)) {
    throw new PublicError(403, "bad_origin", "Use the waitlist form to join.");
  }
}

function enforceRateLimit(map, key, limit, windowMs, message) {
  const now = Date.now();
  const hits = (map.get(key) ?? []).filter((hit) => now - hit < windowMs);

  if (hits.length >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowMs - (now - hits[0])) / 1000),
    );

    map.set(key, hits);
    throw new PublicError(429, "rate_limited", message, retryAfterSeconds);
  }

  hits.push(now);
  map.set(key, hits);
  pruneBuckets(map, windowMs);
}

function isInCooldown(map, key, windowMs) {
  const acceptedAt = map.get(key);
  return typeof acceptedAt === "number" && Date.now() - acceptedAt < windowMs;
}

function pruneBuckets(map, windowMs) {
  const now = Date.now();

  for (const [key, hits] of map) {
    const freshHits = hits.filter((hit) => now - hit < windowMs);
    if (freshHits.length) {
      map.set(key, freshHits);
    } else {
      map.delete(key);
    }
  }
}

function pruneCooldowns(map, windowMs) {
  const now = Date.now();

  for (const [key, acceptedAt] of map) {
    if (now - acceptedAt >= windowMs) {
      map.delete(key);
    }
  }
}

async function forwardSignup(record) {
  const webhookUrl = process.env.WAITLIST_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn("WAITLIST_MISSING_DESTINATION");
    throw new PublicError(
      503,
      "missing_destination",
      "The waitlist is not accepting submissions right now.",
    );
  }

  validateWebhookUrl(webhookUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(record),
      signal: controller.signal,
    });

    if (!webhookResponse.ok) {
      throw new Error(`Webhook returned ${webhookResponse.status}`);
    }
  } catch (error) {
    console.error("WAITLIST_FORWARD_FAILED", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    throw new PublicError(
      502,
      "forward_failed",
      "Unable to join the waitlist right now.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function validateWebhookUrl(webhookUrl) {
  let parsedUrl;

  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new PublicError(
      503,
      "bad_destination",
      "The waitlist is not accepting submissions right now.",
    );
  }

  const isLocalhost =
    parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";

  if (parsedUrl.protocol !== "https:" && !isLocalhost) {
    throw new PublicError(
      503,
      "insecure_destination",
      "The waitlist is not accepting submissions right now.",
    );
  }
}

function getClientIp(request) {
  const forwardedFor = String(request.headers["x-forwarded-for"] ?? "");
  return (
    forwardedFor.split(",")[0]?.trim() ||
    String(request.headers["x-real-ip"] ?? "").trim() ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
