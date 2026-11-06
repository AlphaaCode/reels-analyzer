// Check an edit-plan.json against the edit contract and the video it edits:
// schema/edit-plan.schema.json plus the rules in src/lib/edit/validate.ts
// (the video's hash, times inside it, no overlaps, edges between words, at
// least 3 s left). Prints every error and warning with its JSON path; exits 1
// when there are errors.
//
//   node tools/check-edit.mjs <edit-plan.json> <video>
//
// Word timestamps come from data/words/{sha256}.json, else Whisper
// (WHISPER_API_KEY), else detected silences. A forecast.json beside the plan
// (an edit job folder) fixes forecastState and allows a rehook only when low.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Settings come from .env.local like the app's; the shell's own variables win.
// Before the imports below, because signals.ts reads FFMPEG_PATH as it loads.
if (existsSync(path.join(root, '.env.local'))) process.loadEnvFile(path.join(root, '.env.local'));
const { formatValidation } = await import('../src/lib/validate.ts');
const { loadEditContext, readForecastBeside, validateEditPlan } = await import('../src/lib/edit/validate.ts');

async function main(planFile, video) {
    if (!planFile || !video) {
        console.error('Usage: node tools/check-edit.mjs <edit-plan.json> <video>');
        return 1;
    }
    if (!existsSync(video)) {
        console.error(`No such video: ${video}`);
        return 1;
    }

    let plan;
    try {
        plan = JSON.parse(readFileSync(planFile, 'utf8'));
    } catch (error) {
        console.log(`ERROR /: not readable as JSON (${error.message})`);
        return 1;
    }

    const context = { ...await loadEditContext(video, { root }), forecast: readForecastBeside(planFile) };
    const validation = validateEditPlan(plan, context, root);
    console.log(formatValidation(planFile, validation));
    return validation.errors.length ? 1 : 0;
}

// exitCode, not exit(): lets stdout drain when it is a pipe
process.exitCode = await main(process.argv[2], process.argv[3]);
