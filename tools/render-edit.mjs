// Render an edit-plan.json with ffmpeg and measure the result:
//
//   node tools/render-edit.mjs <edit-plan.json> <video>
//
// Checks the plan first, printing what tools/check-edit.mjs prints and exiting
// 1 on errors. Then writes exports/{sha256}-{n}.mp4 with the plan beside it
// (.plan.json) and the measured before/after signals (.diff.json). The source
// video is only read.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Settings come from .env.local like the app's; the shell's own variables win.
// Before the imports below, because signals.ts reads FFMPEG_PATH as it loads.
if (existsSync(path.join(root, '.env.local'))) process.loadEnvFile(path.join(root, '.env.local'));
const { formatValidation } = await import('../src/lib/validate.ts');
const { loadEditContext, readForecastBeside, validateEditPlan } = await import('../src/lib/edit/validate.ts');
const { renderEdit } = await import('../src/lib/edit/render.ts');

const ROWS = [
    ['duration (s)', s => s.duration],
    ['cuts', s => s.cutCount],
    ['cuts per minute', s => s.cutsPerMinute],
    ['cuts in first 3 s', s => s.cutsInFirstThreeSeconds],
    ['loudness (LUFS)', s => s.loudnessLufs ?? '-'],
    ['silence spans', s => s.silences.length]
];

async function main(planFile, video) {
    if (!planFile || !video) {
        console.error('Usage: node tools/render-edit.mjs <edit-plan.json> <video>');
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
    if (validation.errors.length) return 1;

    const { video: output, plan: planCopy, diff, before, after } = await renderEdit(plan, context, { root });
    const shown = file => path.relative(process.cwd(), file);
    console.log(`\n${shown(output)}\n  plan: ${shown(planCopy)}\n  diff: ${shown(diff)}\n`);
    console.log(`${'measured'.padEnd(20)}${'before'.padStart(10)}${'after'.padStart(10)}`);
    for (const [label, read] of ROWS) {
        console.log(`${label.padEnd(20)}${String(read(before)).padStart(10)}${String(read(after)).padStart(10)}`);
    }
    return 0;
}

// exitCode, not exit(): lets stdout drain when it is a pipe
process.exitCode = await main(process.argv[2], process.argv[3]);
