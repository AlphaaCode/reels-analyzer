// An edit job folder: everything an agent needs to plan one reel's edit, and
// nothing else. The agent runs inside it (src/lib/agent/claude.ts), so its
// file tools never see the rest of the repository.
//
//   signals.json   measured signals (extractSignals)
//   words.json     word timestamps, or why there are none
//   report.json    the app's report for this exact file, when it has one
//   forecast.json  where the reel sits on the validated signal (forecastFor)
//   video.txt      the source's absolute path
//   frame-*.jpg    hook frames, only when report.json is missing
//   tools/check-edit.mjs           the real checker, run on this job's video
//   .claude/skills/reel-edit/      the planning rules
//
// Node runs this directly (tools/prepare-edit.mjs), so imports carry .ts.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { forecastFor, type Calibration, type Forecast } from '../calibration.ts';
import { dataRoot } from '../paths.ts';
import { extractHookThumbnails, extractSignals } from '../signals.ts';
import { loadEditContext } from './validate.ts';
import { sha256File } from './words.ts';

// What every job folder copies from the server's root. The desktop build ships exactly these (electron/stage.mjs).
export const JOB_CHECKER = path.join('tools', 'check-edit.mjs');
export const JOB_SKILL = path.join('.claude', 'skills', 'reel-edit', 'SKILL.md');

/** data/reports/{sha256}.json in the data folder: the full report for the exact file, which an edit job plans from. */
export const reportFile = (root: string, sha256: string): string => path.join(dataRoot(root), 'data', 'reports', `${sha256}.json`);

/** Keep a full report beside the video's hash. Called after every full analysis. */
export async function saveReport(videoPath: string, report: unknown, root = process.cwd()): Promise<void> {
    const file = reportFile(root, await sha256File(videoPath));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(report, null, 2));
}

export interface ForecastFile extends Forecast {
    /** Every measured predictor that survived the correction, strongest first. */
    survivors: { key: string; rho: number; pAdjusted?: number }[];
    /** How many labelled reels the calibration rests on. */
    n?: number;
}

export function forecastFile(calibration: Calibration | undefined, signals: object): ForecastFile {
    return {
        ...forecastFor(calibration, signals),
        survivors: (calibration?.exploratory ?? [])
            .filter(result => calibration?.survivors.includes(result.key))
            .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))
            .map(({ key, rho, pAdjusted }) => ({ key, rho, pAdjusted })),
        n: calibration?.n
    };
}

export interface PreparedJob {
    jobDir: string;
    sha256: string;
    hasReport: boolean;
    forecast: ForecastFile;
}

export async function prepareEditJob(
    video: string,
    jobDir: string,
    { calibration, root = process.cwd() }: { calibration?: Calibration; root?: string } = {}
): Promise<PreparedJob> {
    const videoPath = path.resolve(video);
    mkdirSync(path.join(jobDir, 'tools'), { recursive: true });
    mkdirSync(path.join(jobDir, path.dirname(JOB_SKILL)), { recursive: true });
    const put = (name: string, value: unknown) =>
        writeFileSync(path.join(jobDir, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));

    const [context, signals] = await Promise.all([loadEditContext(videoPath, { root }), extractSignals(videoPath)]);
    const forecast = forecastFile(calibration, signals);
    put('signals.json', signals);
    put('words.json', context.track);
    put('forecast.json', forecast);
    put('video.txt', videoPath);

    const saved = reportFile(root, context.sha256);
    const hasReport = existsSync(saved);
    if (hasReport) {
        copyFileSync(saved, path.join(jobDir, 'report.json'));
    } else {
        // The agent writes its own report from these (planning only, never recorded)
        const frames = await extractHookThumbnails(videoPath, signals.duration);
        frames.forEach((frame, i) => writeFileSync(path.join(jobDir, `frame-${i}.jpg`), Buffer.from(frame.split(',')[1], 'base64')));
    }

    // The agent may only run `node tools/check-edit.mjs`, from inside this folder
    const checker = pathToFileURL(path.join(root, JOB_CHECKER)).href;
    put(JOB_CHECKER, [
        '// This job\'s checker: the real tools/check-edit.mjs, on this job\'s video when none is given.',
        "import { readFileSync } from 'node:fs';",
        "if (process.argv.length === 3) process.argv.push(readFileSync(new URL('../video.txt', import.meta.url), 'utf8').trim());",
        `await import(${JSON.stringify(checker)});`,
        ''
    ].join('\n'));
    copyFileSync(path.join(root, JOB_SKILL), path.join(jobDir, JOB_SKILL));

    return { jobDir, sha256: context.sha256, hasReport, forecast };
}
