<div align="center">

<img src="src/app/icon.png" width="72" alt="Reels Analyzer logo" />

# Reels Analyzer

**An honest, local-first virality check for short-form video.**
Measured signals from ffmpeg, a report from the AI model *you* choose, and a calibration engine that tells you whether the score actually predicts your reach.

[![CI](https://github.com/AlphaaCode/reels-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/AlphaaCode/reels-analyzer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-pink.svg)](LICENSE)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)
![Runs locally](https://img.shields.io/badge/runs-100%25%20local-orange)
![EN / AR](https://img.shields.io/badge/UI-English%20%7C%20%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9-purple)

<img src="docs/assets/demo.gif" width="760" alt="Uploading a reel, getting a score, opening a metric and switching to Arabic" />

</div>

---

## Why this exists

Most "will it go viral?" tools give you a confident number and no way to check it. Reels Analyzer does three things differently:

1. **It measures before it guesses.** Cuts, cuts per minute, loudness (EBU R128), silences, resolution and hook-window frames come from ffmpeg, locally. The AI is told these are ground truth.
2. **You bring the model.** Any OpenAI-compatible vision endpoint (NVIDIA NIM, OpenRouter, a local Ollama model), Gemini's free tier, or no key at all. Your videos never leave your machine unless you pick a cloud model.
3. **It grades itself.** Once you have real numbers for your own reels, the calibration engine runs a Spearman backtest (permutation p-values, Benjamini-Hochberg correction, a minimum sample size, a 14-day maturity window) and shows you which signals track your reach and which don't. The forecast stays locked until the evidence clears the bar.

## Screenshots

| Upload | Report |
| --- | --- |
| <img src="docs/assets/home.png" alt="Upload screen" /> | <img src="docs/assets/results.png" alt="Full report" /> |

| Metric drill-down | Arabic, right-to-left |
| --- | --- |
| <img src="docs/assets/metric-popup.png" alt="Hook strength popup with measured advice" /> | <img src="docs/assets/results-arabic.png" alt="Report in Arabic" /> |

<sub>Screenshots use the bundled synthetic test clip (`docs/assets/demo-reel.mp4`) in signals-only mode, with no API key configured.</sub>

## Features

- **Virality score out of 100**, weighted locally from six 1–10 metrics: hook (25%), pacing (20%), visual quality (15%), trending elements (15%), call to action (15%), rewatch (10%).
- **Hook breakdown**: three thumbnails from the first three seconds plus the cuts measured inside that window.
- **Measured signals panel**: resolution, aspect ratio, frame rate, loudness against the −14 LUFS platform target, pacing and duration, each checked against a target.
- **Metric drill-downs**: click any card for advice written from *this* video's measurements, plus a general playbook.
- **Full transcript, strengths, fixes, caption and hashtags** when an AI provider is configured.
- **Reality Check**: give it a reel's real stats and the report explains the gap between prediction and outcome, with evidence.
- **Track record**: calibration of the score against your own history, including the unflattering parts.
- **Bilingual**: every UI string and every AI field in English and Arabic; the toggle switches instantly with no new request.
- **Strict report contract**: the model writes JSON against [`schema/report.schema.json`](schema/report.schema.json); a validator rejects anything off-contract and asks for up to two repairs before falling back.
- **Graceful fallback chain**: open model → Gemini → deterministic heuristics. The report always says which one produced it and why.

## Quick start

**Requirements:** Node.js 20+, and ffmpeg on your PATH (`ffmpeg -version` to check).

```bash
git clone https://github.com/AlphaaCode/reels-analyzer.git
cd reels-analyzer
npm ci
cp .env.example .env.local   # optional: add a key, see below
npm run dev
```

Open <http://localhost:3000>, drop a video, press **Analyze Virality**.

On Windows you can double-click `start-app.cmd` instead: it starts the server on port 3210 and opens the browser. Install ffmpeg with `winget install Gyan.FFmpeg`.

No key yet? Everything still runs in **signals-only mode**: the scores come from ffmpeg measurements and the report is labelled as such. Try it on the bundled clip: `docs/assets/demo-reel.mp4`.

## Choosing a model

Set these in `.env.local`. [`.env.example`](.env.example) lists tested presets and known limits for each.

| Provider | Variables | Notes |
| --- | --- | --- |
| Any OpenAI-compatible vision model | `OPEN_MODEL_BASE_URL`, `OPEN_MODEL_API_KEY`, `OPEN_MODEL_ID` | NVIDIA NIM, OpenRouter `:free` models, or local Ollama (`http://localhost:11434/v1`, no key). Receives sampled frames plus the transcript. |
| Speech transcript | `WHISPER_API_KEY` (+ `WHISPER_BASE_URL`, `WHISPER_MODEL`) | Open-source Whisper over an OpenAI-compatible endpoint. Optional. |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | Free key from [AI Studio](https://aistudio.google.com/apikey). Watches the actual video with audio; the uploaded file is deleted right after. |
| None | — | Deterministic heuristics from the measured signals. |
| ffmpeg location | `FFMPEG_PATH`, `FFPROBE_PATH` | Only if the binaries are not on your PATH. |

## How it works

```
video ──► ffmpeg signals ──┐
                           ├──► provider (open model → Gemini → heuristic)
prompt + report contract ──┘            │
                                        ▼
                            report.json ──► validator ──► repair (≤2) ──► score + UI
                                                               │
                                       your real stats ──► calibration backtest
```

| Path | What lives there |
| --- | --- |
| `src/lib/signals.ts` | ffprobe metadata, scene cuts, loudness, silences, hook thumbnails |
| `src/lib/providers/` | the provider chain and shared normalisation |
| `prompts/system.md`, `src/lib/prompt.ts` | the prompt, assembled from files rather than buried in code |
| `schema/report.schema.json`, `src/lib/validate.ts` | the report contract and its validator |
| `src/lib/analysis.ts` | the weighted score |
| `src/lib/calibration.ts` | the backtest, unlock gate and noise floor |
| `src/app/api/` | upload, analyze (job + polling), calibration and health routes |

### Command-line tools

```bash
node tools/check.mjs report.json   # validate a report against the contract
node scripts/backfill.mjs 3210     # label cached reels through the running app
node scripts/learn-eval.mjs        # leave-one-out test: does the model's read of content predict reach?
npm test                           # unit tests (Node's built-in runner)
```

### Using your own reels (optional)

The **My Instagram** panel and the calibration engine read a local snapshot at `public/ig-cache/profile.json` (profile, follower count, and each reel's video and real stats). The app does not fetch it for you. Produce it however you like; the shape is defined in `src/components/MyInstagram.tsx`. The folder is gitignored, and so is `data/`, where analysis history and calibration results are kept.

## Privacy

- Videos are stored in `public/uploads/` on your machine and swept after 24 hours.
- Nothing is sent anywhere in signals-only mode or with a local Ollama model.
- With a cloud provider, the frames, transcript or video go to that provider under their terms.
- Analysis history, transcripts and calibration live in `data/` and are never committed.
- Exposing the app beyond `localhost`? Set `APP_PASSWORD` to turn on the built-in password gate.

## Roadmap

- Agent providers: let a local coding agent, through its CLI, write the report against the same contract.
- Reel cards and a playbook that learn from your history, kept only when they pass a replay test.
- An **Edit** tab that turns the report into an edit plan (silence cuts, re-hook, loudness, captions), renders it with ffmpeg, then re-analyses to show measured before/after differences.
- A Windows installer.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Yazid Bensefia
