# Contributing

Thanks for helping improve Reels Analyzer. This guide covers setup, the architecture you need to know before changing things, and the rules every change follows.

## Setup

```bash
npm ci
cp .env.example .env.local    # all keys optional
npm run dev                   # http://localhost:3000
```

ffmpeg and ffprobe must be installed (`winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on macOS, your package manager on Linux); the edit engine needs a build with libass for its `subtitles` filter, which these include. Set `FFMPEG_PATH` / `FFPROBE_PATH` if they are not on PATH; Windows dev servers often start without ffmpeg on PATH.

## Checks

Run all three before opening a pull request; CI runs the same:

```bash
npm run lint
npm test
npm run build
```

For changes to the analysis pipeline, also run a real analysis against the dev server (the bundled `docs/assets/demo-reel.mp4` works with no key) and, if you touched the report format, validate an output with `node tools/check.mjs <report.json>`.

## Architecture

Everything runs server-side in App Router routes:

- **The data folder** (`src/lib/paths.ts`) holds everything the app writes: `data/`, `public/uploads/`, `public/ig-cache/`, `exports/` and `.env.local`. It is the checkout itself unless `APP_DATA_DIR` is set; the Windows app sets it to `%APPDATA%\Reels Analyzer`. Read-only files (prompts, schema, fonts, `tools/`, the planner's skill) always come from the server's own folder. Write new paths through `dataRoot()`, never `process.cwd()`.
- `GET /api/media/{uploads|ig-cache}/...` serves uploads and the Instagram cache from the data folder (`src/lib/media.ts`), with Range support for video seeking. It accepts only safe file names of known media types inside those two folders.
- `POST /api/upload` stores the video as `public/uploads/{uuid}.{ext}` in the data folder and sweeps old uploads, always keeping the three newest.
- `POST /api/analyze/start` then `GET /api/analyze/status?job=` run an analysis as a job (`src/lib/analyzeJob.ts`). `POST /api/analyze` does the same in one call for scripts.
- The pipeline:
  1. **Signals** (`src/lib/signals.ts`): ffprobe metadata, hard cuts and cuts per minute, EBU R128 loudness against −14 LUFS, silence spans, hook thumbnails. Reads are retried because fresh uploads can be briefly locked on Windows.
  2. **Provider chain** (`src/lib/providers/`): `openCompat.ts` (any OpenAI-compatible vision endpoint, sent sampled frames plus an optional Whisper transcript) → `gemini.ts` (uploads the video, deletes it afterwards) → `heuristic.ts` (deterministic, from the signals). Every fall-through is explained in `providerNote`.
  3. **Contract**: the prompt is assembled from `prompts/system.md` by `src/lib/prompt.ts`. Output is checked by `src/lib/validate.ts` against `schema/report.schema.json`, with up to two repair rounds.
  4. **Score** (`src/lib/analysis.ts`): hook 25%, pacing 20%, visual 15%, trending 15%, CTA 15%, rewatch 10%.
- **Reality Check**: when a reel's real stats are passed as `actual`, the provider also returns `performanceReview`. `parseActual` in the analyze route rejects the whole object if any count is missing or negative; extend it when you add fields.
- **Calibration** (`src/lib/calibration.ts`, `src/lib/calibrationStore.ts`): Spearman correlations with permutation p-values, Benjamini-Hochberg correction, an unlock gate and a noise floor, over rows in `data/analyses.json`.
- **Edit engine** (`src/lib/edit/`): a model writes one `edit-plan.json` (`schema/edit-plan.schema.json`) and never touches the video.
  - `validate.ts` checks the plan against the video (`node tools/check-edit.mjs <plan> <video>`).
  - `plan.ts` turns it into the pieces of the source the output plays.
  - `render.ts` renders those pieces in one ffmpeg run (`node tools/render-edit.mjs <plan> <video>`). It writes `exports/{sha256}-{n}.mp4` beside the plan and a before/after diff measured with the same signals.
  - Word timestamps (`words.ts`) come from Whisper and are cached in `data/words/`.
  - Burned-in text uses the bundled Noto fonts in `assets/fonts/` (SIL OFL).

## Windows app

`electron/` wraps the production server in an app window and builds the installer. It has its own `package.json`, so the web app's `npm ci` never downloads Electron.

```bash
npm ci && npm run build          # the web app, at the root
cd electron
npm ci
npm run ffmpeg                   # BtbN's LGPL ffmpeg build, pinned by SHA256, into stage/ffmpeg
npm run stage                    # the server bundle into stage/server
npm start                        # optional: run the app window from source
npm run dist                     # dist/ReelsAnalyzer-Setup-<version>.exe
```

- `main.js` starts `server-host.js`, which runs the standalone server in Electron's own Node, on `127.0.0.1`. It uses port 3217, or any free port when 3217 is taken. The window loads the app once `/api/health` answers.
- The server gets `APP_DATA_DIR`, the bundled `FFMPEG_PATH`/`FFPROBE_PATH`, and the values from the data folder's `.env.local`. It also gets a random `APP_PASSWORD` that only the window sends, so other programs and web pages can't use it.
- `stage.mjs` copies an explicit list of files, never the whole standalone folder, which can trace `data/`, uploads and the Instagram cache in. It refuses to stage if a settings file, a user-data folder or a key-shaped string turns up.
- The version comes from the root `package.json`. Pushing the matching tag `vX.Y.Z` runs `.github/workflows/release.yml`, which builds the installer and publishes it to that tag's GitHub Release, together with `latest.yml` (the update feed) and a `.sha256` file.
- The LGPL ffmpeg has no x264. `render.ts` picks the first H.264 encoder that works: x264, then Windows Media Foundation, then OpenH264.

## Rules

- **Free by default.** The app must work with no paid service. Avoid new npm dependencies unless they remove real complexity.
- **Bilingual everything.** Every UI string is a key in `src/lib/i18n.tsx` with English and Arabic, and layouts must work right-to-left. Every AI prose field is `LocalizedText { en, ar }`. Exception: `transcript` and `hookTranscript` stay verbatim in the spoken language.
- **No emojis** in the UI or in AI output. Icons come from `public/*.png`.
- **Measured over guessed.** Never present a model's guess as a measurement, and never claim a change will raise reach unless the calibration supports it.
- **Defensive normalisation.** Don't assume both language halves exist upstream; `asLocalized` fills a missing half.
- **Private data stays out of git.** `public/uploads/`, `public/ig-cache/` and `data/` are gitignored. Never commit real reels, profiles or analysis history.

## Gotchas

- `MetricModal` renders through `createPortal(..., document.body)`. The results container keeps a `transform` from its fade-in animation, which would otherwise become the containing block for `position: fixed`.
- Free hosts cut responses after about 100 seconds, which is why the UI uses the job routes rather than one long request.

## Commits and pull requests

- One logical change per commit, with a short imperative subject (`Add loudness target to signals panel`).
- Describe what changed and how you verified it in the pull request.
- Include screenshots for UI changes, in both languages if text changed.
