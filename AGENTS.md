# Agent guide

Instructions for coding agents working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md); everything there applies here too.

## Before you change anything

1. Read `CONTRIBUTING.md` (architecture and rules) and the file you are about to edit.
2. Run `npm test` to see the current baseline.

## Hard rules

- Keep the app free to run: no paid services, no new dependencies without a clear reason.
- Every UI string goes through `src/lib/i18n.tsx` with English and Arabic. Every AI prose field is `{ en, ar }`.
- No emojis in UI or model output.
- The report format is defined by `schema/report.schema.json` and enforced by `src/lib/validate.ts`. Change both together, add a test, and keep `node tools/check.mjs` passing.
- Do not move prompt text back into TypeScript; it lives in `prompts/`.
- Never read, print or commit `.env.local`, `public/ig-cache/`, `public/uploads/` or `data/`.
- Keep the current visual design (dark gray surfaces, pink-to-orange gradient accents) unless the task says otherwise.

## Writing a report as an agent

If you are asked to analyse a video yourself rather than through the app:

1. Get the measured signals from the app (`POST /api/analyze` with the `fileId`) or compute them with ffmpeg the same way `src/lib/signals.ts` does.
2. Follow `prompts/system.md` and write a single `report.json` matching `schema/report.schema.json`.
3. Run `node tools/check.mjs report.json` and fix every error before handing it back.

## Done means

- `npm run lint`, `npm test` and `npm run build` pass.
- Behaviour was checked against the running dev server, not only by reading code.
- Commit messages are short, imperative and describe the change.
