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

### Notes:
- The `bun run dev` command starts a local development server and prints the local URL in your terminal.
- Use `bun run preview` to preview the production build locally after running `bun run build`.
- If you encounter issues with Bun, ensure it is correctly installed and updated to the latest version.
- If the local dev server URL is not immediately visible, check the terminal output carefully for the correct address.
