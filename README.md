# semper.systems website

## What is Semper?
Semper quietly captures the context around your work, stores it locally, and helps you find what you were doing without digging through tabs, screenshots, or notes.

## Tech Stack
- Built with Astro + Tailwind
- Deployed on Vercel

## Development

### Prerequisites:
- Node.js 22.12 or newer
- Bun (https://bun.sh/) installed and available in your PATH

### Install dependencies and start the local dev server:

```sh
bun install
bun run dev
```

### Before deploying, verify the production build:

```sh
bun run build
bun run preview
```

## Waitlist

The waitlist page posts to `/api/waitlist`, which is implemented as a Vercel
Function in `api/waitlist.js`.

Set `WAITLIST_WEBHOOK_URL` in Vercel before accepting real signups. The function
fails closed when this value is missing so the site does not pretend an email was
saved. The webhook receives JSON with `event`, `email`, `source`, `site`, and
`createdAt`.

Optional: set `WAITLIST_ALLOWED_ORIGINS` to a comma-separated list of exact
origins if the form should only accept posts from specific domains. Same-origin
requests are allowed by default.

### Notes:
- The `bun run dev` command starts a local development server and prints the local URL in your terminal.
- Use `bun run preview` to preview the production build locally after running `bun run build`.
- If you encounter issues with Bun, ensure it is correctly installed and updated to the latest version.
- If the local dev server URL is not immediately visible, check the terminal output carefully for the correct address.
- To stop the local development server, press `Ctrl+C` in your terminal.
