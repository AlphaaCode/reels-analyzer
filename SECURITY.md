# Security

Reels Analyzer is designed to run on your own machine. It has no accounts and no server of its own.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Report a vulnerability** button on the repository's Security tab, with steps to reproduce. You'll get a reply within a week.

## Good practice for users

- Keep API keys in `.env.local`, which is gitignored. Never commit it.
- If you expose the app beyond `localhost`, set `APP_PASSWORD` to turn on the built-in HTTP Basic gate (`src/proxy.ts`).
- Cloud providers receive the frames, transcript or video you analyse. Use a local model if that matters to you.
