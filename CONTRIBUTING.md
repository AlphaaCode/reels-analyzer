# Contributing

Thanks for helping improve Reels Analyzer. This guide covers setup, the architecture you need to know before changing things, and the rules every change follows.

## Setup

```bash
npm ci
cp .env.example .env.local    # all keys optional
npm run dev                   # http://localhost:3000
```

ffmpeg and ffprobe must be installed (`winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on macOS, your package manager on Linux). Set `FFMPEG_PATH` / `FFPROBE_PATH` if they are not on PATH; Windows dev servers often start without ffmpeg on PATH.

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

- `POST /api/upload` stores the video as `public/uploads/{uuid}.{ext}` and sweeps old uploads, always keeping the three newest.
- `POST /api/analyze/start` then `GET /api/analyze/status?job=` run an analysis as a job (`src/lib/analyzeJob.ts`). `POST /api/analyze` does the same in one call for scripts.
- The pipeline:
  1. **Signals** (`src/lib/signals.ts`): ffprobe metadata, hard cuts and cuts per minute, EBU R128 loudness against −14 LUFS, silence spans, hook thumbnails. Reads are retried because fresh uploads can be briefly locked on Windows.
  2. **Provider chain** (`src/lib/providers/`): `openCompat.ts` (any OpenAI-compatible vision endpoint, sent sampled frames plus an optional Whisper transcript) → `gemini.ts` (uploads the video, deletes it afterwards) → `heuristic.ts` (deterministic, from the signals). Every fall-through is explained in `providerNote`.
  3. **Contract**: the prompt is assembled from `prompts/system.md` by `src/lib/prompt.ts`. Output is checked by `src/lib/validate.ts` against `schema/report.schema.json`, with up to two repair rounds.
  4. **Score** (`src/lib/analysis.ts`): hook 25%, pacing 20%, visual 15%, trending 15%, CTA 15%, rewatch 10%.
- **Reality Check**: when a reel's real stats are passed as `actual`, the provider also returns `performanceReview`. `parseActual` in the analyze route rejects the whole object if any count is missing or negative; extend it when you add fields.
- **Calibration** (`src/lib/calibration.ts`, `src/lib/calibrationStore.ts`): Spearman correlations with permutation p-values, Benjamini-Hochberg correction, an unlock gate and a noise floor, over rows in `data/analyses.json`.

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
