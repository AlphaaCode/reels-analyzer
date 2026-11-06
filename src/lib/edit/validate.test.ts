// Run with: npm test
// The edit contract: what the checker accepts and refuses, and what a plan
// does to the timeline. A hole here means a plan that cuts mid-word, runs past
// the video or leaves next to nothing gets rendered anyway.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FFMPEG, FFPROBE, type VideoProbe } from '../signals.ts';
import { outputWords, planTimeline, silenceRemovals, type EditOp, type EditPlan, type TrimSilenceOp } from './plan.ts';
import { readForecastBeside, validateEditPlan, type EditContext } from './validate.ts';
import { getWords, sha256File, type WordTrack } from './words.ts';

const SHA = 'a'.repeat(64);
const DEMO = path.join('docs', 'assets', 'demo-reel.mp4');
const needsFfmpeg = {
    skip: [FFMPEG, FFPROBE].every(bin => spawnSync(bin, ['-version'], { windowsHide: true }).status === 0)
        ? false : 'ffmpeg is not installed'
};

const l = (en: string, ar: string) => ({ en, ar });
const w = (text: string, start: number, end: number) => ({ text, start, end });

// 15 s: an English phrase, a pause, an Arabic phrase, a long pause, a closing line, then quiet
const WORDS = [
    w('Three', 0.5, 0.9), w('edits', 0.95, 1.4), w('doubled', 1.45, 2), w('my', 2.05, 2.2), w('views.', 2.25, 2.9),
    w('ثلاث', 4, 4.4), w('تعديلات', 4.45, 5), w('فقط.', 5.05, 5.6),
    w('Watch', 8, 8.4), w('to', 8.45, 8.6), w('the', 8.65, 8.8), w('end.', 8.85, 9.5)
];
const speech: WordTrack = { source: 'whisper', words: WORDS, silences: [] };
const unheard: WordTrack = { source: 'silence', words: [], silences: [], unavailable: 'WHISPER_API_KEY is not set' };

function context({ track = speech, ...probe }: Partial<VideoProbe> & { track?: WordTrack } = {}): EditContext {
    return {
        videoPath: 'reel.mp4',
        sha256: SHA,
        track,
        probe: { duration: 15, width: 1080, height: 1920, rotation: 0, sar: '1:1', fps: 30, bitrateKbps: 650, hasVideo: true, hasAudio: true, ...probe }
    };
}

const base = { reason: l('The payoff comes too late.', 'النتيجة تأتي متأخرة جدا.'), finding: '/hookVerdict' };
const cut = (start: number, end: number): EditOp => ({ kind: 'cut', start, end, ...base });
const trimSilence = (minGapSec: number, keepSec: number): TrimSilenceOp => ({ kind: 'trimSilence', minGapSec, keepSec, ...base });
const rehook = (fromSec: number, toSec: number, mode: 'tease' | 'move' = 'tease'): EditOp =>
    ({ kind: 'rehook', fromSec, toSec, mode, ...base });
const hookText = (start: number, end: number): EditOp =>
    ({ kind: 'hookText', text: l('Three edits, double views', 'ثلاثة تعديلات وضعف المشاهدات'), start, end, position: 'top', ...base });
const punchIn = (at: number, durationSec: number, scale = 1.2): EditOp => ({ kind: 'punchIn', at, durationSec, scale, ...base });
const loudnorm: EditOp = { kind: 'loudnorm', targetLufs: -14, ...base };
const captions = (style: 'bold' | 'clean' = 'bold'): EditOp => ({ kind: 'captions', style, ...base });

const planOf = (...ops: EditOp[]): EditPlan =>
    ({ sourceSha256: SHA, reportRef: 'report.json', forecastState: 'locked', language: 'en', ops });

const check = (plan: unknown, ctx = context()) => validateEditPlan(plan, ctx);
// Every error the way the CLI prints it: path, then message
const errorsOf = (plan: unknown, ctx = context()) => check(plan, ctx).errors.map(issue => `${issue.path}: ${issue.message}`);

const rounded = (t: number) => Math.round(t * 1000) / 1000;
const pieces = (plan: EditPlan) =>
    planTimeline(plan, 15, speech).segments.map(s => [rounded(s.start), rounded(s.end), s.scale, s.tease]);

// ---- the checker -----------------------------------------------------------

test('a plan using every op passes with no errors and no warnings', () => {
    const plan = planOf(
        rehook(8, 9.5), cut(0.5, 0.95), trimSilence(0.6, 0.2), hookText(0, 2),
        loudnorm, captions('clean'), punchIn(4, 1.5), punchIn(8.4, 0.6, 1.1)
    );
    assert.deepEqual(check(plan), { errors: [], warnings: [] });
});

test('the schema comes first, and a malformed op is judged by its kind alone', () => {
    const withOp = (op: unknown) => errorsOf({ ...planOf(loudnorm), ops: [op] });
    assert.deepEqual(withOp({ kind: 'cut', start: 1, ...base }), ['/ops/0/end: is missing']);
    assert.deepEqual(withOp({ ...punchIn(4, 1), scale: 1.5 }), ['/ops/0/scale: must be at most 1.3, got 1.5']);
    assert.deepEqual(withOp({ ...loudnorm, targetLufs: -10 }), ['/ops/0/targetLufs: must be at most -14, got -10']);
    assert.deepEqual(withOp({ ...captions(), reason: l('Burn in captions.', 'Burn in captions.') }),
        ['/ops/0/reason/ar: must be written in Arabic (no Arabic script found)']);
    assert.deepEqual(withOp({ kind: 'zoom', ...base }),
        ['/ops/0/kind: must be one of "cut", "trimSilence", "rehook", "hookText", "loudnorm", "captions", "punchIn", got "zoom"']);
    assert.deepEqual(withOp({ start: 1, end: 2, ...base }), ['/ops/0/kind: is missing']);
    assert.deepEqual(withOp('cut 1 to 2'), ['/ops/0: expected object, got string']);
    assert.deepEqual(check({ ...planOf(loudnorm), ops: [{ ...loudnorm, note: 'louder' }] }),
        { errors: [], warnings: [{ path: '/ops/0/note', message: 'unknown key, ignored' }] });

    const plan = planOf(cut(5.6, 16));
    assert.deepEqual(errorsOf({ ...plan, sourceSha256: 'abc' }), ['/sourceSha256: must match ^[0-9a-f]{64}$'],
        'the rules wait for a well-formed plan: no "past the end" yet');
    assert.deepEqual(errorsOf({ ...plan, language: 'fr' }), ['/language: must be one of "en", "ar", got "fr"']);
    assert.deepEqual(errorsOf(planOf(...Array.from({ length: 13 }, () => loudnorm))), ['/ops: must have at most 12 items, got 13']);
});

test('a plan applies only to the file it was written for, which must have video', () => {
    assert.deepEqual(errorsOf({ ...planOf(loudnorm), sourceSha256: 'b'.repeat(64) }),
        [`/sourceSha256: does not match the video (${SHA}): the plan was written for another file`]);
    assert.deepEqual(errorsOf(planOf(loudnorm), context({ hasVideo: false })), [': the source has no video stream']);
});

test('every finding names a field report.json can have', () => {
    const at = (finding: string) => errorsOf(planOf({ ...loudnorm, finding }));
    for (const finding of ['/hookVerdict', '/hookVerdict/en', '/improvements/4', '/metricAdvice/pacing/0', '/recommendations/5']) {
        assert.deepEqual(at(finding), [], finding);
    }
    assert.deepEqual(at('/hookAnalysis/verdict'), ['/ops/0/finding: /hookAnalysis/verdict is not a report.json field (schema/report.schema.json)']);
    assert.deepEqual(at('/improvements/5'), ['/ops/0/finding: /improvements/5 is not a report.json field (schema/report.schema.json)']);
    assert.deepEqual(at('hookVerdict'), ['/ops/0/finding: must match ^(/[^/]+)+$']);
});

test('times stay inside the video', () => {
    assert.deepEqual(errorsOf(planOf(cut(5.6, 16))), ['/ops/0/end: is past the end of the video (15 s)']);
    assert.deepEqual(errorsOf(planOf(cut(5.6, 5.6))), ['/ops/0/end: must be after start']);
    assert.deepEqual(errorsOf(planOf(rehook(8, 16))), ['/ops/0/toSec: is past the end of the video (15 s)']);
    assert.deepEqual(errorsOf(planOf(punchIn(14, 2))), ['/ops/0/durationSec: runs past the end of the video (15 s)']);
    assert.deepEqual(errorsOf(planOf(hookText(2, 2))), ['/ops/0/end: must be after start']);
    // Plans are written from rounded numbers: 0.05 s past the end still counts as the end
    assert.deepEqual(errorsOf(planOf(cut(12, 15.04))), []);
});

test('cut and rehook edges sit between words', () => {
    assert.deepEqual(errorsOf(planOf(cut(1.2, 2.9))),
        ['/ops/0/start: falls inside the word "edits" (0.95 s to 1.4 s); move it to a word edge']);
    assert.deepEqual(errorsOf(planOf(rehook(8, 9.2))),
        ['/ops/0/toSec: falls inside the word "end." (8.85 s to 9.5 s); move it to a word edge']);
    // Whisper's times are estimates: 0.05 s into a word is still its edge
    assert.deepEqual(errorsOf(planOf(cut(0.99, 2.86))), []);
});

test('cuts and the rehook line never overlap, nor do punch-ins', () => {
    assert.deepEqual(errorsOf(planOf(cut(2.9, 4.45), cut(4, 5.6))), ['/ops/1: overlaps the cut at /ops/0']);
    assert.deepEqual(errorsOf(planOf(rehook(8, 9.5), cut(8.85, 9.5))), ['/ops/1: overlaps the rehook at /ops/0']);
    assert.deepEqual(errorsOf(planOf(cut(8, 8.85), rehook(8, 9.5))), ['/ops/1: overlaps the cut at /ops/0']);
    assert.deepEqual(errorsOf(planOf(punchIn(4, 2), punchIn(5, 2))), ['/ops/1: overlaps the punchIn at /ops/0']);
    // Touching is not overlapping, and a punch-in may span a cut
    assert.deepEqual(errorsOf(planOf(cut(2.9, 4), cut(4, 5.6), punchIn(2, 4))), []);
});

test('whole-video ops appear at most once', () => {
    for (const op of [trimSilence(0.6, 0.2), rehook(8, 9.5), hookText(0, 2), loudnorm, captions()]) {
        assert.deepEqual(errorsOf(planOf(op, op)), [`/ops/1: only one ${op.kind} is allowed; the first is /ops/0`], op.kind);
    }
});

test('rehook and captions need word timestamps; cuts without them get a warning', () => {
    const without = context({ track: unheard });
    const needs = ['/ops/0: needs word timestamps, which are unavailable: WHISPER_API_KEY is not set'];
    assert.deepEqual(errorsOf(planOf(rehook(8, 9.5)), without), needs);
    assert.deepEqual(errorsOf(planOf(captions()), without), needs);
    assert.deepEqual(check(planOf(cut(1.2, 2.9)), without), {
        errors: [],
        warnings: [{ path: '/ops', message: 'cut edges were not checked against words: WHISPER_API_KEY is not set' }]
    });
});

test('trimSilence and loudnorm need an audio track', () => {
    const mute = context({ hasAudio: false, track: { ...unheard, unavailable: 'the video has no audio track' } });
    assert.deepEqual(errorsOf(planOf(loudnorm), mute), ['/ops/0: needs an audio track']);
    assert.deepEqual(errorsOf(planOf(trimSilence(0.6, 0.2)), mute), ['/ops/0: needs an audio track']);
});

test('trimSilence keeps less than it trims, and says when it finds nothing to trim', () => {
    assert.deepEqual(errorsOf(planOf(trimSilence(0.6, 0.6))), ['/ops/0/keepSec: must be shorter than minGapSec']);
    assert.deepEqual(check(planOf(trimSilence(0.6, 0.2)), context({ track: unheard })), {
        errors: [],
        warnings: [{ path: '/ops/0', message: 'finds no silence of 0.6 s or longer, so it changes nothing' }]
    });
});

test('an edit leaves at least 3 s, and hook text fits in what is left', () => {
    assert.deepEqual(errorsOf(planOf(cut(0, 12.5))), ['/ops: leave 2.5 s of video; an edit must leave at least 3 s']);
    // Trimming the pauses leaves 6.5 s of these 15
    assert.deepEqual(errorsOf(planOf(trimSilence(0.6, 0.2), hookText(0, 7))), ['/ops/1/end: is past the end of the edited video (6.5 s)']);
    assert.deepEqual(errorsOf(planOf(trimSilence(0.6, 0.2), hookText(0, 6.5))), []);
});

// ---- what a plan does to the timeline --------------------------------------

test('cuts and trimmed pauses come out, whatever the op order', () => {
    const plan = planOf(cut(0.5, 0.95), trimSilence(0.6, 0.2));
    assert.deepEqual(pieces(plan), [[0, 0.5, 1, false], [0.95, 3, 1, false], [3.9, 5.7, 1, false], [7.9, 9.6, 1, false]]);
    assert.deepEqual(pieces({ ...plan, ops: [...plan.ops].reverse() }), pieces(plan));
    // A pause keeps keepSec, half beside the speech on each side; one before the first word or after the last loses everything else
    assert.deepEqual(silenceRemovals(speech, 15, trimSilence(0.4, 0.2)).map(s => [rounded(s.start), rounded(s.end)]),
        [[0, 0.4], [3, 3.9], [5.7, 7.9], [9.6, 15]]);
});

test('a tease plays the line first and again in place; a move plays it first only', () => {
    assert.deepEqual(pieces(planOf(rehook(8, 9.5))), [[8, 9.5, 1, true], [0, 15, 1, false]]);
    assert.deepEqual(pieces(planOf(rehook(8, 9.5, 'move'))), [[8, 9.5, 1, true], [0, 8, 1, false], [9.5, 15, 1, false]]);
    assert.equal(planTimeline(planOf(rehook(8, 9.5)), 15, speech).duration, 16.5);
});

test('a punch-in splits what it covers, the tease included', () => {
    assert.deepEqual(pieces(planOf(punchIn(4, 2))), [[0, 4, 1, false], [4, 6, 1.2, false], [6, 15, 1, false]]);
    assert.deepEqual(pieces(planOf(rehook(8, 9.5), punchIn(8.4, 0.6, 1.1))), [
        [8, 8.4, 1, true], [8.4, 9, 1.1, true], [9, 9.5, 1, true],
        [0, 8.4, 1, false], [8.4, 9, 1.1, false], [9, 15, 1, false]
    ]);
});

test('captions follow the edit: cut words are gone, teased words play twice', () => {
    const { segments } = planTimeline(planOf(rehook(8, 9.5), cut(0.5, 0.95)), 15, speech);
    const placed = outputWords(segments, WORDS);
    assert.deepEqual(placed.map(word => word.text), [
        'Watch', 'to', 'the', 'end.',
        'edits', 'doubled', 'my', 'views.', 'ثلاث', 'تعديلات', 'فقط.', 'Watch', 'to', 'the', 'end.'
    ]);
    assert.deepEqual(placed.map(word => word.tease), [...Array(4).fill(true), ...Array(11).fill(false)]);
    // After the 1.5 s tease and the 0.5 s kept before the cut
    assert.deepEqual([rounded(placed[4].start), rounded(placed[4].end)], [2, 2.45]);
});

// ---- word timestamps -------------------------------------------------------

// No test may send audio to Whisper: the key is taken away for the duration
async function withoutWhisperKey(run: (dir: string) => Promise<void>) {
    const key = process.env.WHISPER_API_KEY;
    const dir = mkdtempSync(path.join(tmpdir(), 'words-'));
    delete process.env.WHISPER_API_KEY;
    try {
        await run(dir);
    } finally {
        if (key !== undefined) process.env.WHISPER_API_KEY = key;
        rmSync(dir, { recursive: true, force: true });
    }
}

test('word timestamps come from the cache when there is one', () => withoutWhisperKey(async dir => {
    writeFileSync(path.join(dir, `${SHA}.json`), JSON.stringify({ sha256: SHA, language: 'en', words: WORDS }));
    assert.deepEqual(await getWords('reel.mp4', { sha256: SHA, hasAudio: true, cacheDir: dir }), speech);
    assert.deepEqual(await getWords('reel.mp4', { sha256: SHA, hasAudio: false, cacheDir: dir }),
        { source: 'silence', words: [], silences: [], unavailable: 'the video has no audio track' });
}));

test('without a key the track falls back to detected silences and nothing is cached', needsFfmpeg, () => withoutWhisperKey(async dir => {
    // The demo is music throughout: silencedetect runs and finds no pause
    assert.deepEqual(await getWords(DEMO, { sha256: SHA, hasAudio: true, cacheDir: dir }),
        { source: 'silence', words: [], silences: [], unavailable: 'WHISPER_API_KEY is not set' });
    assert.equal(existsSync(path.join(dir, `${SHA}.json`)), false);
}));

// ---- the forecast from the job folder --------------------------------------

test('a forecast.json fixes forecastState and allows a rehook only in the low band', () => {
    const plan = planOf(rehook(8, 9.5), loudnorm);
    assert.deepEqual(errorsOf(plan), [], 'no forecast given: no forecast rule');
    assert.deepEqual(errorsOf({ ...plan, forecastState: 'low' }, { ...context(), forecast: 'low' }), []);
    assert.deepEqual(errorsOf(plan, { ...context(), forecast: 'mid' }), [
        '/forecastState: is locked, but forecast.json says mid',
        '/ops/0: a rehook is only for a reel in the low band; this one is mid'
    ]);
    assert.deepEqual(errorsOf({ ...planOf(loudnorm), forecastState: 'high' }, { ...context(), forecast: 'high' }), []);
});

test('readForecastBeside reads forecast.json next to the plan, or nothing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'forecast-'));
    try {
        const planFile = path.join(dir, 'edit-plan.json');
        assert.equal(readForecastBeside(planFile), undefined);
        writeFileSync(path.join(dir, 'forecast.json'), JSON.stringify({ state: 'mid', value: 2 }));
        assert.equal(readForecastBeside(planFile), 'mid');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ---- tools/check-edit.mjs --------------------------------------------------

test('tools/check-edit.mjs passes a sound plan and fails a broken one', needsFfmpeg, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-edit-'));
    try {
        const sourceSha256 = await sha256File(DEMO);
        // Nothing below depends on word timestamps, so a cached track for the demo changes nothing
        const files = { good: path.join(dir, 'good.json'), bad: path.join(dir, 'bad.json'), broken: path.join(dir, 'broken.json') };
        writeFileSync(files.good, JSON.stringify({ ...planOf(hookText(0, 2), punchIn(4, 2), loudnorm), sourceSha256 }));
        writeFileSync(files.bad, JSON.stringify({ ...planOf({ ...loudnorm, finding: '/hookAnalysis/verdict' }, punchIn(14, 2)), sourceSha256 }));
        writeFileSync(files.broken, '{ "ops": [');
        // A blank key wins over the real one in .env.local, so the CLI transcribes nothing
        const env = { ...process.env, WHISPER_API_KEY: ' ', FFMPEG_PATH: FFMPEG, FFPROBE_PATH: FFPROBE };
        const run = (...args: string[]) => spawnSync(process.execPath, ['tools/check-edit.mjs', ...args], { encoding: 'utf8', env });

        const passed = run(files.good, DEMO);
        assert.equal(passed.status, 0, passed.stdout + passed.stderr);
        assert.match(passed.stdout, /good\.json: OK \(0 error\(s\), 0 warning\(s\)\)/);

        const failed = run(files.bad, DEMO);
        assert.equal(failed.status, 1, failed.stdout + failed.stderr);
        assert.match(failed.stdout, /ERROR \/ops\/0\/finding: \/hookAnalysis\/verdict is not a report\.json field/);
        assert.match(failed.stdout, /ERROR \/ops\/1\/durationSec: runs past the end of the video \(15 s\)/);

        const unreadable = run(files.broken, DEMO);
        assert.equal(unreadable.status, 1);
        assert.match(unreadable.stdout, /ERROR \/: not readable as JSON/);

        const usage = run();
        assert.equal(usage.status, 1);
        assert.match(usage.stderr, /Usage: node tools\/check-edit\.mjs <edit-plan\.json> <video>/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
