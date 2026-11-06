// Run with: npm test (the renders skip where ffmpeg is not installed)
// Renders each op on docs/assets/demo-reel.mp4 and measures what came out:
// the length the plan promised, text and zoom on screen, loudness on target,
// no export overwritten and the source exactly as it was.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FFMPEG, FFPROBE, probeVideo } from '../signals.ts';
import { planTimeline, type EditOp, type EditPlan } from './plan.ts';
import { exportFile, renderEdit, type MeasuredSignals } from './render.ts';
import { loadEditContext, type EditContext } from './validate.ts';
import { sha256File, type WordTrack } from './words.ts';

const DEMO = path.join('docs', 'assets', 'demo-reel.mp4');
const needsFfmpeg = [FFMPEG, FFPROBE].every(bin => spawnSync(bin, ['-version'], { windowsHide: true }).status === 0)
    ? false : 'ffmpeg is not installed';

const l = (en: string, ar: string) => ({ en, ar });
const w = (text: string, start: number, end: number) => ({ text, start, end });

// The demo is music: these words (English, then Arabic) stand in for Whisper's
// so rehook and captions have something to cut on and show
const WORDS = [
    w('Three', 0.5, 0.9), w('edits', 0.95, 1.4), w('doubled', 1.45, 2), w('my', 2.05, 2.2), w('views.', 2.25, 2.9),
    w('ثلاث', 4, 4.4), w('تعديلات', 4.45, 5), w('فقط.', 5.05, 5.6),
    w('Watch', 8, 8.4), w('to', 8.45, 8.6), w('the', 8.65, 8.8), w('end.', 8.85, 9.5)
];
const track: WordTrack = { source: 'whisper', words: WORDS, silences: [] };

const base = { reason: l('The payoff comes too late.', 'النتيجة تأتي متأخرة جدا.'), finding: '/hookVerdict' };
const hook = l('Three edits, double views', 'ثلاثة تعديلات وضعف المشاهدات');

// Frame n, shrunk and grey: enough to see text or a zoom, and cheap to compare
const frame = (video: string, n: number): Buffer => execFileSync(FFMPEG, [
    '-v', 'error', '-i', video, '-vf', `select=eq(n\\,${n}),scale=108:192,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'
], { windowsHide: true });

// The largest pixel change from the source on frame n, for edits that keep the timing
function change(video: string, n: number): number {
    const [source, edited] = [frame(DEMO, n), frame(video, n)];
    return source.reduce((most, value, i) => Math.max(most, Math.abs(value - edited[i])), 0);
}

// Drawn on frame `on`, gone again by frame `off`: only re-encoding noise is left there
function shows(video: string, on: number, off: number) {
    assert.ok(change(video, on) > 100, `nothing new on frame ${on} (largest change ${change(video, on)})`);
    assert.ok(change(video, off) < 40, `frame ${off} should look like the source (largest change ${change(video, off)})`);
}

interface Case {
    name: string;
    seconds: number;    // the length the plan promises, worked out by hand
    ops: EditOp[];
    language?: 'en' | 'ar';
    check?: (video: string, after: MeasuredSignals) => void;
}

const CASES: Case[] = [
    { name: 'cut', seconds: 13.9, ops: [{ kind: 'cut', start: 2.9, end: 4, ...base }] },
    // The pauses 2.9-4, 5.6-8 and 9.5-15 keep 0.2 s each, the last one 0.1 s
    { name: 'trimSilence', seconds: 6.5, ops: [{ kind: 'trimSilence', minGapSec: 0.6, keepSec: 0.2, ...base }] },
    { name: 'rehook tease', seconds: 16.5, ops: [{ kind: 'rehook', fromSec: 8, toSec: 9.5, mode: 'tease', ...base }] },
    { name: 'rehook move', seconds: 15, ops: [{ kind: 'rehook', fromSec: 8, toSec: 9.5, mode: 'move', ...base }] },
    {
        name: 'hookText in Arabic', seconds: 15, language: 'ar',
        ops: [{ kind: 'hookText', text: hook, start: 0, end: 2.5, position: 'center', ...base }],
        check: video => shows(video, 30, 360)
    },
    { name: 'captions', seconds: 15, ops: [{ kind: 'captions', style: 'bold', ...base }], check: video => shows(video, 30, 360) },
    { name: 'punchIn', seconds: 15, ops: [{ kind: 'punchIn', at: 4, durationSec: 2, scale: 1.2, ...base }], check: video => shows(video, 150, 360) },
    {
        name: 'loudnorm', seconds: 15, ops: [{ kind: 'loudnorm', targetLufs: -14, ...base }],
        check: (_, after) => assert.ok(Math.abs((after.loudnessLufs ?? NaN) + 14) <= 1, `${after.loudnessLufs} LUFS`)
    },
    {
        // 6.05 s left after the cut and the pauses, then the 1.5 s line again up front
        name: 'every op at once', seconds: 7.55,
        ops: [
            { kind: 'rehook', fromSec: 8, toSec: 9.5, mode: 'tease', ...base },
            { kind: 'cut', start: 0.5, end: 0.95, ...base },
            { kind: 'trimSilence', minGapSec: 0.6, keepSec: 0.2, ...base },
            { kind: 'hookText', text: hook, start: 0, end: 2, position: 'top', ...base },
            { kind: 'captions', style: 'clean', ...base },
            { kind: 'punchIn', at: 8.4, durationSec: 0.6, scale: 1.1, ...base },
            { kind: 'loudnorm', targetLufs: -14, ...base }
        ]
    }
];

const planFor = (context: EditContext, ops: EditOp[], language: 'en' | 'ar' = 'en'): EditPlan =>
    ({ sourceSha256: context.sha256, reportRef: 'report.json', forecastState: 'low', language, ops });

test('a plan with errors is refused before anything is written', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'exports-'));
    const outDir = path.join(dir, 'exports');
    try {
        // Never reaches ffmpeg: the context can be made up
        const context: EditContext = {
            videoPath: DEMO, sha256: 'a'.repeat(64), track,
            probe: { duration: 15, width: 1080, height: 1920, rotation: 0, sar: '1:1', fps: 30, bitrateKbps: 650, hasVideo: true, hasAudio: true }
        };
        await assert.rejects(renderEdit(planFor(context, [{ kind: 'cut', start: 5.6, end: 16, ...base }]), context, { outDir }),
            /The edit plan has errors:\n- \/ops\/0\/end: is past the end of the video \(15 s\)/);
        assert.equal(existsSync(outDir), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('each op renders on the demo reel and measures as planned', { skip: needsFfmpeg, concurrency: 3 }, async t => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'exports-'));
    const source = { sha256: await sha256File(DEMO), modified: statSync(DEMO).mtimeMs };
    const context = await loadEditContext(DEMO, { track });
    // Number 1 is taken by an earlier export: the renders must number around it, not over it
    const earlier = path.join(outDir, `${context.sha256}-1.mp4`);
    writeFileSync(earlier, 'an earlier export');
    const videos: string[] = [];
    try {
        await Promise.all(CASES.map(({ name, seconds, ops, language, check }) => t.test(name, async () => {
            const plan = planFor(context, ops, language);
            assert.ok(Math.abs(planTimeline(plan, 15, track).duration - seconds) < 0.001, 'the plan keeps what the case says');

            const out = await renderEdit(plan, context, { outDir });
            videos.push(out.video);
            const probe = await probeVideo(out.video);
            assert.deepEqual([probe.width, probe.height, probe.hasAudio], [1080, 1920, true]);
            // Segment edges move to the nearest frame; audio ends with the video (loudnorm used to run 67 ms over here)
            assert.ok(Math.abs(probe.duration - seconds) < 1 / 30, `${probe.duration} s long, planned ${seconds} s`);
            assert.deepEqual(JSON.parse(readFileSync(out.plan, 'utf8')), plan);
            assert.deepEqual(JSON.parse(readFileSync(out.diff, 'utf8')), {
                sourceSha256: context.sha256,
                video: path.basename(out.video),
                plan: path.basename(out.plan),
                before: out.before,
                after: out.after
            });
            assert.equal(out.before.duration, 15);
            check?.(out.video, out.after);
        })));

        await t.test('no export is overwritten', () => {
            assert.equal(readFileSync(earlier, 'utf8'), 'an earlier export');
            assert.equal(new Set(videos).size, CASES.length);
            assert.ok(!videos.includes(earlier));
            assert.equal(readdirSync(outDir).length, 1 + 3 * CASES.length, 'an mp4, a plan and a diff per render, nothing else');
        });
        await t.test('the source file is untouched', async () => {
            assert.deepEqual({ sha256: await sha256File(DEMO), modified: statSync(DEMO).mtimeMs }, source);
        });
    } finally {
        rmSync(outDir, { recursive: true, force: true });
    }
});

test('exportFile accepts only export ids and stays inside the exports folder', () => {
    const dir = path.join('C:', 'app', 'exports');
    const id = `${'a'.repeat(64)}-3`;
    assert.equal(exportFile(dir, id, '.mp4'), path.resolve(dir, `${id}.mp4`));
    for (const bad of ['../../.env.local', `${id}/../../x`, `..\${id}`, 'a'.repeat(64), `${id}.mp4`, `${'A'.repeat(64)}-1`, 42, undefined]) {
        assert.equal(exportFile(dir, bad, '.mp4'), undefined, String(bad));
    }
});
