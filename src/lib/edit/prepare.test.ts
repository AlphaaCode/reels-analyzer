// Run with: npm test
// An edit job folder holds what the agent needs, its forecast comes from the
// same forecastFor as the card, and its checker runs on the job's video.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Calibration } from '../calibration.ts';
import { FFMPEG, FFPROBE } from '../signals.ts';
import { forecastFile, prepareEditJob } from './prepare.ts';

// Tests never call Whisper
delete process.env.WHISPER_API_KEY;

const DEMO = path.join('docs', 'assets', 'demo-reel.mp4');
const needsFfmpeg = {
    skip: [FFMPEG, FFPROBE].every(bin => spawnSync(bin, ['-version'], { windowsHide: true }).status === 0)
        ? false : 'ffmpeg is not installed'
};
const band = (min: number, max: number) => ({ min, max, count: 4, q25: 10, q50: 20, q75: 30, breakouts: 1 });
const calibration = {
    n: 12,
    signalKey: 'cutsPerMinute',
    signalBands: [band(0, 2), band(2.1, 5), band(5.1, 30)],
    survivors: ['cutsPerMinute', 'loudnessLufs'],
    exploratory: [
        { key: 'pacing', rho: 0.9, p: 0.5, pAdjusted: 0.6 },
        { key: 'loudnessLufs', rho: 0.3, p: 0.01, pAdjusted: 0.05 },
        { key: 'cutsPerMinute', rho: 0.6, p: 0.001, pAdjusted: 0.004 }
    ]
} as unknown as Calibration;

test('forecastFile adds the surviving predictors, strongest first, to forecastFor', () => {
    const forecast = forecastFile(calibration, { cutsPerMinute: 3 });
    assert.equal(forecast.state, 'mid');
    assert.equal(forecast.value, 3);
    assert.deepEqual(forecast.survivors.map(s => s.key), ['cutsPerMinute', 'loudnessLufs']);
    assert.equal(forecast.n, 12);
    assert.equal(forecastFile(undefined, { cutsPerMinute: 3 }).state, 'locked');
});

test('prepareEditJob writes the job folder and binds its checker to the video', needsFfmpeg, async () => {
    const jobDir = mkdtempSync(path.join(tmpdir(), 'edit-job-'));
    try {
        const job = await prepareEditJob(DEMO, jobDir, { calibration });
        for (const file of ['signals.json', 'words.json', 'forecast.json', 'video.txt', 'tools/check-edit.mjs', '.claude/skills/reel-edit/SKILL.md']) {
            assert.ok(existsSync(path.join(jobDir, file)), file);
        }
        assert.equal(readFileSync(path.join(jobDir, 'video.txt'), 'utf8'), path.resolve(DEMO));
        // The demo measures 8 cuts per minute: the last band
        assert.equal(JSON.parse(readFileSync(path.join(jobDir, 'forecast.json'), 'utf8')).state, 'high');
        // Hook frames only when the agent has to write its own report
        const frames = readdirSync(jobDir).filter(f => f.startsWith('frame-'));
        assert.equal(existsSync(path.join(jobDir, 'report.json')), job.hasReport);
        assert.equal(frames.length > 0, !job.hasReport);

        const plan = {
            sourceSha256: job.sha256, reportRef: 'report.json', forecastState: 'high', language: 'en',
            ops: [{ kind: 'loudnorm', targetLufs: -14, reason: { en: 'Measured loudness.', ar: 'مستوى الصوت المقاس.' }, finding: '/metrics/visualQuality' }]
        };
        writeFileSync(path.join(jobDir, 'edit-plan.json'), JSON.stringify(plan));
        const env = { ...process.env, WHISPER_API_KEY: ' ', FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE };
        const check = () => spawnSync(process.execPath, ['tools/check-edit.mjs', 'edit-plan.json'], { cwd: jobDir, encoding: 'utf8', env });
        const passed = check();
        assert.equal(passed.status, 0, passed.stdout + passed.stderr);
        assert.match(passed.stdout, /edit-plan\.json: OK/);

        // forecast.json beside the plan is enforced
        writeFileSync(path.join(jobDir, 'edit-plan.json'), JSON.stringify({ ...plan, forecastState: 'low' }));
        const failed = check();
        assert.equal(failed.status, 1);
        assert.match(failed.stdout, /ERROR \/forecastState: is low, but forecast\.json says high/);
    } finally {
        rmSync(jobDir, { recursive: true, force: true });
    }
});
