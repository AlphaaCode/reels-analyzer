# Agent guide

Instructions for coding agents working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md); everything there applies here too.

## Before you change anything

1. Read `CONTRIBUTING.md` (architecture and rules) and the file you are about to edit.
2. Run `npm test` to see the current baseline.

## Hard rules

- Keep the app free to run: no paid services, no new dependencies without a clear reason.
- Every UI string goes through `src/lib/i18n.tsx` with English and Arabic. Every AI prose field is `{ en, ar }`.
- No emojis in UI or model output.
- The report format is defined by `schema/report.schema.json` and enforced by `src/lib/validate.ts`. Change both together, add a test, and keep `node tools/check.mjs` passing. The same goes for the edit plan: `schema/edit-plan.schema.json`, `src/lib/edit/validate.ts` and `node tools/check-edit.mjs`.
- Do not move prompt text back into TypeScript; it lives in `prompts/`.
- Never read, print or commit `.env.local`, `public/ig-cache/`, `public/uploads/` or `data/`, in the checkout or in the Windows app's data folder (`%APPDATA%\Reels Analyzer`).
- Keep the current visual design (dark gray surfaces, pink-to-orange gradient accents) unless the task says otherwise.

## Writing a report as an agent

If you are asked to analyse a video yourself rather than through the app:

1. Get the measured signals from the app (`POST /api/analyze` with the `fileId`) or compute them with ffmpeg the same way `src/lib/signals.ts` does.
2. Follow `prompts/system.md` and write a single `report.json` matching `schema/report.schema.json`.
3. Run `node tools/check.mjs report.json` and fix every error before handing it back.

## Writing an edit plan as an agent

You never edit the video yourself; you write the plan and the app renders it.

1. Start from a checked `report.json` for the same video: each op answers one of its findings.
2. Write a single `edit-plan.json` matching `schema/edit-plan.schema.json`.
   - Include the video's sha256.
   - Give every op a `finding` that points at the report field it answers (`/hookVerdict`, `/improvements/0`) and a `reason` in English and Arabic.
   - Times are seconds in the source, except hookText's, which are seconds of the edited video.
3. Run `node tools/check-edit.mjs edit-plan.json <video>` and fix every error.
   - Cut and rehook edges must sit between words.
   - Without word timestamps (no `WHISPER_API_KEY`), rehook and captions are refused.
4. Run `node tools/render-edit.mjs edit-plan.json <video>`. It writes to `exports/` and prints the measured before and after. Report those numbers, never a predicted reach or score.

The easy way is `/edit-reel <video or job folder>` in Claude Code in this repo. It runs `node tools/prepare-edit.mjs` to build a job folder (signals, words, report, `forecast.json`), and the `reel-edit` skill holds the rules and the four strategies by forecast state. Inside a job folder, `forecastState` must match `forecast.json`, and only a `low` reel may be rehooked.

The app's Edit tab runs the same flow on the user's own Claude Code (`src/lib/agent/claude.ts`). It is confined to the job folder: reads and writes there only, no `.env` files, and Bash only as `node tools/check-edit.mjs`. Its gate (`GET /api/edit/gate`) checks that the `claude` CLI is on PATH and that a one-turn call to `claude-opus-5-5` succeeds. That is a convenience gate in open-source code, not a licence check: anyone can edit it, and it protects nothing.

## Done means

- `npm run lint`, `npm test` and `npm run build` pass.
- Behaviour was checked against the running dev server, not only by reading code.
- Commit messages are short, imperative and describe the change.
