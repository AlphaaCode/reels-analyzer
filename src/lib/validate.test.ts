// Run with: npm test
// The report contract: what the checker accepts, what it rejects, and how the
// repair loop spends its two rounds. A hole here means a broken report renders
// as if it were fine, or a measured score gets "repaired" from text.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    loadReportSchema,
    validateReport,
    validateWithRepair,
    type JsonSchema,
    type RepairRequest,
    type ValidateOptions
} from './validate.ts';

const schema = loadReportSchema();
const SIX = ['hookStrength', 'visualQuality', 'pacing', 'trendingElements', 'engagementCTA', 'rewatchPotential'];

const l = (en: string, ar: string) => ({ en, ar });
const line = l('The hook lands at 0:01 with a bold claim.', 'يصل الخطاف عند الثانية الأولى بادعاء جريء.');
const lines = (n: number) => Array.from({ length: n }, () => ({ ...line }));

function validReport(): Record<string, unknown> {
    return {
        metrics: Object.fromEntries(SIX.map(key => [key, 6])),
        summary: l('A clear, well-paced reel with a strong opening.', 'ريل واضح وجيد الإيقاع مع افتتاحية قوية.'),
        hookVerdict: { ...line },
        strengths: lines(3),
        improvements: lines(3),
        recommendations: lines(6),
        metricAdvice: Object.fromEntries(SIX.map(key => [key, lines(2)])),
        suggestedCaption: l('Three edits that doubled my watch time.', 'ثلاث تعديلات ضاعفت مدة المشاهدة.'),
        hashtags: ['#reels', '#editing', '#ريلز', '#video_tips', '#creator', '#content', '#hook', '#2026'],
        transcript: 'مرحبا بكم في هذا الفيديو',
        hookTranscript: 'مرحبا بكم'
    };
}

const validReview = () => ({ verdict: 'as-expected', whyItHappened: lines(3), whatToDoNext: lines(2) });

const check = (report: unknown, options: ValidateOptions = {}) => validateReport(report, schema, options);
const errorAt = (report: unknown, at: string, options: ValidateOptions = {}) =>
    check(report, options).errors.find(issue => issue.path === at);

test('a complete report passes with no errors and no warnings', () => {
    assert.deepEqual(check(validReport()), { errors: [], warnings: [] });
    assert.deepEqual(check({ ...validReport(), performanceReview: validReview() }, { expectReview: true }), { errors: [], warnings: [] });
});

test('loading refuses schema keywords the validator does not implement', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'contract-'));
    try {
        mkdirSync(path.join(root, 'schema'));
        writeFileSync(path.join(root, 'schema', 'report.schema.json'), JSON.stringify({
            type: 'object',
            properties: { summary: { anyOf: [{ type: 'string' }] } }
        }));
        assert.throws(() => loadReportSchema(root), /unsupported keyword "anyOf"/);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('missing and mistyped fields are errors', () => {
    const report = validReport();
    delete report.summary;
    assert.match(errorAt(report, '/summary')?.message ?? '', /missing/);

    const localizedTranscript = { ...validReport(), transcript: l('Hello', 'مرحبا') };
    assert.match(errorAt(localizedTranscript, '/transcript')?.message ?? '', /expected string, got object.*never an \{en, ar\}/);

    const plainString = { ...validReport(), summary: 'A plain string' };
    assert.match(errorAt(plainString, '/summary')?.message ?? '', /expected object, got string/);
});

test('scores are integers from 1 to 10, in full reports and scores-only answers', () => {
    const tooHigh = validReport();
    (tooHigh.metrics as Record<string, number>).pacing = 11;
    assert.match(errorAt(tooHigh, '/metrics/pacing')?.message ?? '', /at most 10/);

    const fractional = validReport();
    (fractional.metrics as Record<string, number>).pacing = 7.5;
    assert.match(errorAt(fractional, '/metrics/pacing')?.message ?? '', /expected integer/);

    const scores = Object.fromEntries(SIX.map(key => [key, 5]));
    assert.deepEqual(check(scores, { scoresOnly: true }).errors, []);
    delete scores.pacing;
    assert.match(errorAt(scores, '/pacing', { scoresOnly: true })?.message ?? '', /missing/);
});

test('counts and lengths are enforced', () => {
    const five = { ...validReport(), recommendations: lines(5) };
    assert.match(errorAt(five, '/recommendations')?.message ?? '', /exactly 6 items, got 5/);

    const tooMany = { ...validReport(), strengths: lines(6) };
    assert.match(errorAt(tooMany, '/strengths')?.message ?? '', /at most 5 items/);

    const long = validReport();
    (long.strengths as { en: string }[])[0].en = 'Long sentence. '.repeat(20);
    assert.match(errorAt(long, '/strengths/0/en')?.message ?? '', /300 characters, the limit is 250/);

    const empty = { ...validReport(), hookVerdict: l('', 'نص') };
    assert.match(errorAt(empty, '/hookVerdict/en')?.message ?? '', /must not be empty/);
});

test('an emoji anywhere is an error', () => {
    const prose = { ...validReport(), hookVerdict: l('Strong start \u{1F525}', 'بداية قوية') };
    assert.match(errorAt(prose, '/hookVerdict/en')?.message ?? '', /emoji \(U\+1F525\)/);

    const caption = { ...validReport(), suggestedCaption: l('Watch till the end', 'شاهد حتى النهاية ❤️') };
    assert.ok(errorAt(caption, '/suggestedCaption/ar'));
});

test('each language half is written in its own language', () => {
    const untranslated = { ...validReport(), summary: l('Same English text', 'Same English text') };
    assert.match(errorAt(untranslated, '/summary/ar')?.message ?? '', /Arabic/);

    const arabicOnly = { ...validReport(), summary: l('ملخص', 'ملخص') };
    assert.match(errorAt(arabicOnly, '/summary/en')?.message ?? '', /English/);
});

test('hashtags are single words that start with #', () => {
    for (const bad of ['reels', '#two words', '#tip-of-the-day']) {
        const report = validReport();
        (report.hashtags as string[])[0] = bad;
        assert.ok(errorAt(report, '/hashtags/0'), `${bad} should be rejected`);
    }
});

test('performanceReview follows whether real stats were given', () => {
    assert.match(errorAt(validReport(), '/performanceReview', { expectReview: true })?.message ?? '', /required/);

    const unasked = { ...validReport(), performanceReview: { verdict: 'great' } };
    const ignored = check(unasked, { expectReview: false });
    assert.deepEqual(ignored.errors, []);
    assert.equal(ignored.warnings[0]?.path, '/performanceReview');

    // Without context (the CLI) a present review is still checked
    assert.ok(errorAt(unasked, '/performanceReview/verdict'));
});

test('unknown keys are warnings, not errors', () => {
    const result = check({ ...validReport(), viralityScore: 88 });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings.map(issue => issue.path), ['/viralityScore']);
});

test('every report field is described in prompts/system.md with its counts and limits', () => {
    const described = readFileSync('prompts/system.md', 'utf8').split(/\r?\n/);
    const limitsOf = (node: JsonSchema): number[] => [
        ...[node.minItems, node.maxItems, node.maxLength, node.minimum, node.maximum].filter((n): n is number => n !== undefined),
        ...[node.items, ...Object.values(node.properties ?? {})].filter((child): child is JsonSchema => Boolean(child)).flatMap(limitsOf)
    ];
    const { performanceReview, ...fields } = schema.properties ?? {};
    for (const [key, node] of Object.entries({ ...fields, ...performanceReview?.properties })) {
        const text = described.find(entry => entry.startsWith(`- ${key}:`));
        assert.ok(text, `prompts/system.md has no "- ${key}:" line`);
        for (const limit of new Set(limitsOf(node))) {
            assert.match(text, new RegExp(`\\b${limit}\\b`), `"- ${key}:" should state ${limit}, as the schema does`);
        }
    }
});

// ---- repair loop -----------------------------------------------------------

const isMetrics = (key: string) => key === 'metrics';

test('a broken answer is repaired with the previous answer and the errors, merging only the broken keys', async () => {
    const broken = { ...validReport(), recommendations: lines(5) };
    const requests: RepairRequest[] = [];
    const outcome = await validateWithRepair({
        ask: async () => JSON.stringify(broken),
        repair: async request => {
            requests.push(request);
            return JSON.stringify({ recommendations: lines(6), summary: l('Rewritten', 'أعيدت كتابته') });
        },
        check: value => check(value),
        isFrozen: isMetrics
    });
    assert.equal(outcome.rounds, 1);
    assert.deepEqual(outcome.validation.errors, []);
    assert.deepEqual(requests[0].keys, ['recommendations']);
    assert.match(requests[0].previous, /"recommendations"/);
    assert.match(requests[0].errors[0].message, /exactly 6 items/);
    assert.deepEqual(outcome.value?.summary, broken.summary, 'keys that were not broken must not change');
});

test('repairs stop after two rounds and keep the best answer', async () => {
    let repairs = 0;
    const outcome = await validateWithRepair({
        ask: async () => JSON.stringify({ ...validReport(), recommendations: lines(5) }),
        // Strictly worse: one item, and it carries an emoji (two errors instead of one)
        repair: async () => { repairs++; return JSON.stringify({ recommendations: [l('Bad \u{1F525}', 'سيئ')] }); },
        check: value => check(value),
        isFrozen: isMetrics
    });
    assert.equal(repairs, 2);
    assert.equal(outcome.rounds, 2);
    assert.equal(outcome.validation.errors.length, 1);
    assert.match(outcome.validation.errors[0].message, /got 5/, 'a worse repair must not replace the better answer');
});

test('scores are never repaired from text', async () => {
    let repairs = 0;
    const report = validReport();
    (report.metrics as Record<string, number>).pacing = 11;
    const outcome = await validateWithRepair({
        ask: async () => JSON.stringify({ ...report, recommendations: lines(5) }),
        repair: async () => { repairs++; return '{}'; },
        check: value => check(value),
        isFrozen: isMetrics
    });
    assert.equal(repairs, 0);
    assert.equal(outcome.rounds, 0);
    assert.ok(outcome.validation.errors.some(issue => issue.path === '/metrics/pacing'));
});

test('an answer that is not JSON is asked again, not repaired', async () => {
    const answers = ['Sorry, here is my analysis: none', JSON.stringify(validReport())];
    let repairs = 0;
    const outcome = await validateWithRepair({
        ask: async () => answers.shift() ?? '',
        repair: async () => { repairs++; return '{}'; },
        check: value => check(value),
        isFrozen: isMetrics
    });
    assert.equal(repairs, 0);
    assert.equal(outcome.rounds, 1);
    assert.deepEqual(outcome.validation.errors, []);
});

test('a failed repair request keeps the answer; a failed re-ask with nothing usable throws', async () => {
    const kept = await validateWithRepair({
        ask: async () => JSON.stringify({ ...validReport(), recommendations: lines(5) }),
        repair: async () => { throw new Error('HTTP 429'); },
        check: value => check(value),
        isFrozen: isMetrics
    });
    assert.equal((kept.value?.recommendations as unknown[]).length, 5);

    let asks = 0;
    await assert.rejects(validateWithRepair({
        ask: async () => { if (asks++ === 0) return 'not json'; throw new Error('HTTP 503'); },
        repair: async () => '{}',
        check: value => check(value)
    }), /HTTP 503/);
});

// ---- tools/check.mjs -------------------------------------------------------

test('tools/check.mjs accepts a valid report and rejects a broken one', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-'));
    try {
        const good = path.join(dir, 'good.json');
        const bad = path.join(dir, 'bad.json');
        writeFileSync(good, JSON.stringify(validReport()));
        writeFileSync(bad, JSON.stringify({ ...validReport(), recommendations: lines(5), summary: l('Great \u{1F525}', 'رائع') }));
        const run = (file: string) => spawnSync(process.execPath, ['tools/check.mjs', file], { encoding: 'utf8' });

        const passed = run(good);
        assert.equal(passed.status, 0, passed.stdout + passed.stderr);
        assert.match(passed.stdout, /OK/);

        const failed = run(bad);
        assert.equal(failed.status, 1, failed.stdout + failed.stderr);
        assert.match(failed.stdout, /ERROR \/recommendations: must have exactly 6 items, got 5/);
        assert.match(failed.stdout, /ERROR \/summary\/en: contains an emoji/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
