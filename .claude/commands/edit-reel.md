---
description: Plan, check and render an edit of one reel from its report and forecast state
argument-hint: <video or edit job folder>
allowed-tools: Read, Write, Bash(node tools/prepare-edit.mjs:*), Bash(node tools/check.mjs:*), Bash(node tools/check-edit.mjs:*), Bash(node tools/render-edit.mjs:*)
---

Edit the reel at `$ARGUMENTS`. Run every `node tools/...` command below with the Bash tool (not PowerShell): those are the commands this command allows. You write the plan; the tools check and render it. Follow the `reel-edit` skill (.claude/skills/reel-edit/SKILL.md) for the ops, the rules and the strategy for each forecast state.

1. **Job folder.**
   - If `$ARGUMENTS` is a video, run `node tools/prepare-edit.mjs $ARGUMENTS`. It prints the job folder it made.
   - If it is already a job folder (it has `video.txt`), run `node tools/prepare-edit.mjs $ARGUMENTS` to see what it holds.

   Call the folder JOB and the source video VIDEO (from `JOB/video.txt`).
2. **Report.** If `JOB/report.json` is missing, the app has never analysed this exact file. Write one yourself, following AGENTS.md ("Writing a report as an agent") and `prompts/system.md`, from:
   - `JOB/signals.json`;
   - `JOB/words.json`;
   - the hook frames `JOB/frame-*.jpg`.

   Then run `node tools/check.mjs JOB/report.json` and fix every error. This report is for planning only: never add it to `data/analyses.json` or the calibration.
3. **Forecast.** Read `JOB/forecast.json`. Its `state` is the plan's `forecastState` and picks the strategy. Its numbers are what reasons may quote about the account's history.
4. **Plan.** Write `JOB/edit-plan.json`. Every op has a finding that is a real report.json path and a reason in English and Arabic that quotes the measurement or finding it rests on.
5. **Check.** Run `node tools/check-edit.mjs JOB/edit-plan.json VIDEO`. Fix every ERROR and run it again, with at most 2 repair rounds. If it still fails, stop and show the errors.
6. **Render.** Run `node tools/render-edit.mjs JOB/edit-plan.json VIDEO`.
7. **Report back:**
   - the forecast state and the numbers behind it;
   - each op with its reason;
   - the measured before/after table exactly as printed.

   Never say or imply that the edit will raise reach, views or the score. A re-analysis of the export is a new estimate, not proof.
