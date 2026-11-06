// Prepare an edit job folder for one reel: measured signals, word timestamps,
// the app's report for this exact file (if it has one), the forecast state,
// a checker bound to the video and the reel-edit skill (src/lib/edit/prepare.ts).
//
//   node tools/prepare-edit.mjs <video> [jobDir]
//   node tools/prepare-edit.mjs <jobDir>          prints what an existing job holds
//
// The forecast reads data/calibration.json as the app last cached it. Without
// it the state is locked. Prints the job folder and whether report.json is
// missing; when it is, the agent writes one for planning only (never recorded).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Settings come from .env.local like the app's; the shell's own variables win.
// Before the imports below, because signals.ts reads FFMPEG_PATH as it loads.
if (existsSync(path.join(root, '.env.local'))) process.loadEnvFile(path.join(root, '.env.local'));
const { prepareEditJob } = await import('../src/lib/edit/prepare.ts');
const { sha256File } = await import('../src/lib/edit/words.ts');

async function describe(jobDir) {
    const video = readFileSync(path.join(jobDir, 'video.txt'), 'utf8').trim();
    const forecast = JSON.parse(readFileSync(path.join(jobDir, 'forecast.json'), 'utf8'));
    const value = forecast.value === undefined ? '' : ` (${forecast.signalKey} ${forecast.value})`;
    console.log(`job: ${path.relative(process.cwd(), jobDir) || '.'}`);
    console.log(`video: ${video}`);
    console.log(`sha256: ${await sha256File(video)}  (the plan's sourceSha256)`);
    console.log(`forecast: ${forecast.state}${value}`);
    console.log(existsSync(path.join(jobDir, 'report.json'))
        ? 'report.json: from the app'
        : 'report.json: MISSING - write one per AGENTS.md (planning only) and check it with node tools/check.mjs');
}

async function main(target, jobArg) {
    if (!target || !existsSync(target)) {
        console.error('Usage: node tools/prepare-edit.mjs <video> [jobDir]  |  node tools/prepare-edit.mjs <jobDir>');
        return 1;
    }
    if (statSync(target).isDirectory()) {
        if (!existsSync(path.join(target, 'video.txt'))) {
            console.error(`${target} is not an edit job folder (no video.txt)`);
            return 1;
        }
        await describe(target);
        return 0;
    }

    const calibrationFile = path.join(root, 'data', 'calibration.json');
    const calibration = existsSync(calibrationFile) ? JSON.parse(readFileSync(calibrationFile, 'utf8')) : undefined;
    const sha256 = await sha256File(target);
    const jobDir = path.resolve(jobArg ?? path.join(root, 'data', 'edit-jobs', `${sha256.slice(0, 8)}-${Date.now()}`));
    await prepareEditJob(target, jobDir, { calibration, root });
    await describe(jobDir);
    return 0;
}

// exitCode, not exit(): lets stdout drain when it is a pipe
process.exitCode = await main(process.argv[2], process.argv[3]);
