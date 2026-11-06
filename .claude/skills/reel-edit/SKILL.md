---
name: reel-edit
description: Plan an edit of one Instagram reel as edit-plan.json, from its report.json, measured signals, word timestamps and forecast.json. Use when asked to edit, tighten, rehook or caption a reel in this repo, or when an edit job folder has to be planned.
---

# Planning a reel edit

You write one `edit-plan.json`. You never touch the video: the app checks the plan against the video and renders it with ffmpeg. You never promise reach, views or a score. The only numbers anyone sees afterwards are measured ones.

## What you have (the job folder)

| file | what it is |
|---|---|
| `report.json` | the app's analysis of this exact file (schema/report.schema.json). Every op answers one of its findings. |
| `signals.json` | measured with ffmpeg: `duration`, `cutCount`, `cutsPerMinute`, `avgShotSeconds`, `cutsInFirstThreeSeconds`, `loudnessLufs`, `silences` (spans of at least 1 s) |
| `words.json` | word timestamps `{ text, start, end }`. If `unavailable` is set there are no words: no rehook, no captions, and cut edges go unchecked. |
| `forecast.json` | `state` (locked, low, mid or high), `signalKey`, the reel's `value`, its `band` (min, max, count, q25, q50, q75), the `best` band, and the `survivors` with rho |
| `tools/check-edit.mjs` | `node tools/check-edit.mjs edit-plan.json` checks the plan against this job's video |

## The plan

```json
{
  "sourceSha256": "<copy from the checker's error, or sha256 of the video>",
  "reportRef": "report.json",
  "forecastState": "<forecast.json state, exactly>",
  "language": "en | ar (the language spoken in the reel)",
  "ops": [ ... 1 to 12 ops ... ]
}
```

Every op has a `reason` `{ en, ar }` of at most 250 characters each and a `finding`, a JSON pointer to the report field it answers.

### Ops

| kind | fields | notes |
|---|---|---|
| `cut` | `start`, `end` | removes start..end. Edges fall between words. Cuts don't overlap each other or the rehook line. |
| `trimSilence` | `minGapSec` (0.2-5), `keepSec` (0-2, less than minGapSec) | shortens every pause of at least minGapSec to keepSec. At most one. Needs audio. |
| `rehook` | `fromSec`, `toSec`, `mode` (`tease` or `move`) | opens on that line. tease copies it to the start and keeps it in place; move takes it out. Needs words. At most one. **Only when forecastState is low.** |
| `hookText` | `text {en, ar}` (60 chars each), `start`, `end`, `position` (top, center, bottom) | on-screen text. Times are seconds of the **edited** video. At most one. |
| `loudnorm` | `targetLufs`: -14 | two-pass EBU R128. At most one. Needs audio. |
| `captions` | `style`: `bold` or `clean` | verbatim, in the spoken language, timed to the words. Needs words. At most one. |
| `punchIn` | `at`, `durationSec` (0.2-10), `scale` (1.05-1.3) | centred zoom. Punch-ins don't overlap each other. |

### Rules the checker enforces

- Times are source seconds, except hookText's, which are edited-output seconds (0 is the first frame the viewer sees). Op order doesn't matter.
- Every time lies inside the video, and every end comes after its start.
- Cut and rehook edges sit between words, with 0.05 s of slack.
- At least 3 s of video must be left, and the hook text has to end inside it.
- `forecastState` must equal forecast.json's `state`.
- `finding` must be a real report.json path:
  - `/hookVerdict`, `/summary`, `/transcript`, `/hookTranscript`
  - `/metrics/hookStrength`, `/metrics/pacing`, `/metrics/visualQuality`, `/metrics/engagementCTA`, `/metrics/rewatchPotential`, `/metrics/trendingElements`
  - `/improvements/0` to `/improvements/4`, `/recommendations/0` to `/recommendations/5`, `/strengths/0` to `/strengths/4`
  - `/metricAdvice/pacing/0` to `/metricAdvice/pacing/2`, and the same for every metric

  `/hookAnalysis/verdict` does not exist.

## Strategy by forecast state

The state comes from the account's own history: the band this reel falls in on the one measured signal that survived calibration. It sets how much you change.

- **locked** (no signal has survived calibration, or the reel has no value for it): measured craft fixes only.
  - Silences over 0.6 s: `trimSilence` with `minGapSec` 0.6.
  - Loudness to -14 LUFS when `loudnessLufs` is more than 1 LU away.
  - A cut or punch-in inside the first 3 s when `cutsInFirstThreeSeconds` is 0.
  - No rehook.
- **low** (the reel is in the weakest band): bold.
  - Rehook from the strongest spoken line, in `tease` mode. Pick a whole sentence from words.json that states the payoff, ideally the one the report's hookVerdict or improvements point at.
  - Trim toward the best band's cut rate: remove dead time with cuts and trimSilence, and add punch-ins where a shot runs long.
  - Hook text in the spoken language.
- **mid**: moderate. The craft fixes above, trimming toward the best band's cut rate, and hook text. No rehook.
- **high** (already in the strongest band): minimal. Loudness, captions (if there are words) and at most one trim. Put why less is more in a reason: this reel already sits in the band with the best observed reach, so heavy changes risk what is working.

### Reasons quote their evidence

Each reason names the measurement or report finding it rests on, with the number:

- "Pause of 1.4 s at 6.2 s (signals.json silences)."
- "Loudness measured at -21.3 LUFS."
- "cuts per minute is 2.0; the best band starts at 3.4."
- "The report's hook verdict: the payoff comes at 8 s."

Never write that the edit will raise reach, views or the score. You may say what the account's history shows ("reels in the best band had a median reach of 4,957 across 15 reels"), never what this reel will get.

## Loop

1. Read forecast.json, report.json, signals.json and words.json.
2. Write edit-plan.json.
3. Run `node tools/check-edit.mjs edit-plan.json`. Fix every ERROR and run it again, at most 2 repair rounds. Warnings may stay if the reason is understood.
4. Stop when it prints `OK`. Rendering is not your job unless you were asked to run `node tools/render-edit.mjs`; then report its measured table and nothing else.

## Example 1: English, low

forecast.json (excerpt):
```json
{ "state": "low", "signalKey": "cutsPerMinute", "value": 0,
  "band": { "min": 0, "max": 0, "count": 14, "q50": 1290 },
  "best": { "min": 3.4, "max": 21.7, "count": 15, "q50": 4957 } }
```
signals.json: duration 24.0, cutCount 0, cutsInFirstThreeSeconds 0, loudnessLufs -19.6, silences [{6.1, 7.5}].
words.json: "So here's the trick nobody tells you." runs 14.2 to 16.8.
report.json `/hookVerdict`: the opening is a slow greeting and the payoff arrives at 14 s.

```json
{
  "sourceSha256": "<sha256>",
  "reportRef": "report.json",
  "forecastState": "low",
  "language": "en",
  "ops": [
    { "kind": "rehook", "fromSec": 14.2, "toSec": 16.8, "mode": "tease",
      "reason": { "en": "The report's hook verdict says the payoff arrives at 14 s; open on that line (14.2-16.8 s).", "ar": "يقول حكم الافتتاحية في التقرير إن الفكرة الأساسية تأتي عند 14 ثانية؛ نبدأ بتلك الجملة (14.2-16.8 ث)." },
      "finding": "/hookVerdict" },
    { "kind": "cut", "start": 0.0, "end": 2.4,
      "reason": { "en": "A 2.4 s greeting before any content; cuts per minute is 0, and the best band starts at 3.4.", "ar": "تحية مدتها 2.4 ثانية قبل أي محتوى؛ عدد القطعات في الدقيقة 0، وأفضل فئة تبدأ من 3.4." },
      "finding": "/metrics/pacing" },
    { "kind": "trimSilence", "minGapSec": 0.6, "keepSec": 0.2,
      "reason": { "en": "Measured pause of 1.4 s at 6.1 s; pauses over 0.6 s are shortened to 0.2 s.", "ar": "توقف مقاس مدته 1.4 ثانية عند 6.1 ث؛ تُختصر التوقفات الأطول من 0.6 ث إلى 0.2 ث." },
      "finding": "/improvements/0" },
    { "kind": "punchIn", "at": 9.0, "durationSec": 2.0, "scale": 1.15,
      "reason": { "en": "One shot holds for the whole 24 s (0 cuts measured); a punch-in breaks it.", "ar": "لقطة واحدة تستمر 24 ثانية كاملة (0 قطعات مقاسة)؛ التقريب يكسرها." },
      "finding": "/metricAdvice/pacing/0" },
    { "kind": "hookText", "text": { "en": "The trick nobody tells you", "ar": "الحيلة التي لا يخبرك بها أحد" },
      "start": 0, "end": 2.6, "position": "top",
      "reason": { "en": "No on-screen text in the first 3 s; the line states the payoff in the spoken language.", "ar": "لا يوجد نص على الشاشة في أول 3 ثوانٍ؛ السطر يذكر الفكرة بلغة الكلام." },
      "finding": "/improvements/1" },
    { "kind": "loudnorm", "targetLufs": -14,
      "reason": { "en": "Loudness measured at -19.6 LUFS; the platform target is -14.", "ar": "مستوى الصوت المقاس -19.6 LUFS؛ هدف المنصة -14." },
      "finding": "/metrics/visualQuality" }
  ]
}
```

## Example 2: Arabic, high

forecast.json (excerpt):
```json
{ "state": "high", "signalKey": "cutsPerMinute", "value": 9.2,
  "band": { "min": 3.4, "max": 21.7, "count": 15, "q50": 4957 } }
```
signals.json: duration 31.5, cutsPerMinute 9.2, loudnessLufs -17.8, silences [{22.0, 23.3}].
words.json has Arabic words throughout.

```json
{
  "sourceSha256": "<sha256>",
  "reportRef": "report.json",
  "forecastState": "high",
  "language": "ar",
  "ops": [
    { "kind": "loudnorm", "targetLufs": -14,
      "reason": { "en": "Loudness measured at -17.8 LUFS. The reel already sits in the band with the best observed reach (9.2 cuts per minute), so only measured fixes.", "ar": "مستوى الصوت المقاس -17.8 LUFS. المقطع في الفئة ذات أفضل وصول ملاحظ (9.2 قطعة في الدقيقة)، لذا نكتفي بإصلاحات مقاسة." },
      "finding": "/metrics/visualQuality" },
    { "kind": "captions", "style": "clean",
      "reason": { "en": "Speech runs throughout and the report notes no captions; verbatim Arabic captions, nothing else changes.", "ar": "الكلام مستمر طوال المقطع والتقرير يذكر غياب الترجمة؛ ترجمة عربية حرفية دون أي تغيير آخر." },
      "finding": "/recommendations/0" },
    { "kind": "cut", "start": 22.0, "end": 23.3,
      "reason": { "en": "The one measured silence, 1.3 s at 22.0 s. A single trim: heavier changes risk what already works.", "ar": "الصمت المقاس الوحيد، 1.3 ثانية عند 22.0 ث. اختصار واحد فقط: التغييرات الأكبر قد تضر بما ينجح بالفعل." },
      "finding": "/metricAdvice/pacing/0" }
  ]
}
```
