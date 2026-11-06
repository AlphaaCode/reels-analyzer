// Run with: npm test
// Covers only the load-bearing statistics — a silent error here would show up
// as a confident, wrong prediction, which is the one failure mode this whole
// feature exists to prevent.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    benjaminiHochberg,
    buildLabelledReels,
    calibrate,
    forecastFor,
    MIN_LABELLED,
    permutationP,
    quantile,
    rank,
    spearman,
    weightedScore,
    type LabelledReel
} from './calibration.ts';
import type { AnalysisMetrics, MetricKey } from '../types/analysis.ts';

const WEIGHTS: Record<MetricKey, number> = {
    hookStrength: 0.25, visualQuality: 0.15, pacing: 0.20,
    trendingElements: 0.15, engagementCTA: 0.15, rewatchPotential: 0.10
};

const metrics = (value: number): AnalysisMetrics => ({
    hookStrength: value, visualQuality: value, pacing: value,
    trendingElements: value, engagementCTA: value, rewatchPotential: value
});

// n reels whose reach either tracks the score exactly or ignores it entirely
function reels(count: number, mode: 'monotone' | 'flat' | 'inverse'): LabelledReel[] {
    return Array.from({ length: count }, (_, i) => {
        // metrics ramp 1..10 across the set, so score tracks position
        const score = 1 + Math.floor((i * 9) / Math.max(count - 1, 1));
        const reach = mode === 'monotone' ? 100 * (i + 1)
            : mode === 'inverse' ? 100 * (count - i)
            : [500, 20, 9000, 130, 4000, 60, 700, 2, 15000, 40][i % 10];
        return {
            mediaId: `m${i}`,
            metrics: metrics(score),
            signals: { duration: 30, cutsPerMinute: 10, cutsInFirstThreeSeconds: 1, avgShotSeconds: 6, loudnessLufs: -14 },
            reach,
            // Dates deliberately scrambled (coprime stride) so post date carries no
            // information — these fixtures test the score itself, not the calendar.
            postedAt: new Date(Date.UTC(2026, 0, 1 + ((i * 7) % count))).toISOString(),
            runs: 1
        };
    });
}

test('rank averages ties', () => {
    assert.deepEqual(rank([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test('spearman is +1 when monotone, -1 when reversed', () => {
    assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
});

test('quantile interpolates', () => {
    assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
    assert.equal(quantile([10, 20], 0.5), 15);
});

test('permutation p separates real signal from noise', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const monotone = x.map(v => v * 3);
    const scrambled = [7, 2, 11, 1, 9, 4, 12, 3, 6, 10, 5, 8];
    assert.ok(permutationP(x, monotone, 2000) < 0.01, 'perfect relationship should be significant');
    assert.ok(permutationP(x, scrambled, 2000) > 0.10, 'scrambled data should not be significant');
});

test('benjamini-hochberg raises p-values and stays monotone', () => {
    const adjusted = benjaminiHochberg([0.01, 0.04, 0.2, 0.5]);
    assert.ok(adjusted.every((value, index) => value >= [0.01, 0.04, 0.2, 0.5][index]));
    assert.ok(adjusted[0] <= adjusted[1] && adjusted[1] <= adjusted[2] && adjusted[2] <= adjusted[3]);
});

test('weightedScore applies the supplied weights', () => {
    assert.equal(weightedScore(metrics(10), WEIGHTS), 100);
    assert.equal(weightedScore(metrics(5), WEIGHTS), 50);
});

test('too few reels stays locked no matter how clean the signal', () => {
    const result = calibrate(reels(MIN_LABELLED - 1, 'monotone'), WEIGHTS, { iterations: 500 });
    assert.equal(result.unlocked, false);
    assert.match(result.lockReason ?? '', /mature labelled reels/);
});

test('no relationship stays locked and says so', () => {
    const result = calibrate(reels(20, 'flat'), WEIGHTS, { iterations: 2000 });
    assert.equal(result.unlocked, false);
    assert.match(result.lockReason ?? '', /No measurable link/);
});

test('a strong positive relationship with enough reels unlocks', () => {
    const result = calibrate(reels(24, 'monotone'), WEIGHTS, { iterations: 2000 });
    assert.equal(result.unlocked, true);
    assert.ok(result.score.rho > 0.5);
    assert.equal(result.tiers.length, 3);
});

test('a significant inverse relationship raises an alarm instead of unlocking', () => {
    const result = calibrate(reels(24, 'inverse'), WEIGHTS, { iterations: 2000 });
    assert.equal(result.unlocked, false);
    assert.ok(result.alarm, 'expected an alarm for a backwards score');
    assert.ok(result.score.rho < 0);
});

test('repeat analyses collapse to one row with median metrics', () => {
    const now = Date.UTC(2026, 7, 20);
    const posted = new Date(Date.UTC(2026, 5, 1)).toISOString();
    const record = (score: number, observedAt: string) => ({
        id: `r${score}${observedAt}`,
        fileId: 'f1',
        source: 'ig-cache' as const,
        mediaId: 'same-reel',
        analyzedAt: observedAt,
        provider: 'gemini' as const,
        metrics: metrics(score),
        signals: {
            duration: 30, fps: 30, cutsPerMinute: 10, cutsInFirstThreeSeconds: 1,
            avgShotSeconds: 6, loudnessLufs: -14, silenceCount: 0, isVertical: true, hasAudio: true
        },
        outcome: {
            views: 100, reach: 80, likes: 5, comments: 1, saved: 1, shares: 1,
            followers: 10000, postedAt: posted, observedAt
        }
    });

    const rows = buildLabelledReels(
        [record(4, '2026-08-01T00:00:00Z'), record(8, '2026-08-02T00:00:00Z'), record(6, '2026-08-03T00:00:00Z')],
        now
    );
    assert.equal(rows.length, 1, 'three runs of one reel must not become three data points');
    assert.equal(rows[0].runs, 3);
    assert.equal(rows[0].metrics.hookStrength, 6, 'median of 4, 8, 6');
});

test('reels younger than the maturity window are excluded', () => {
    const now = Date.UTC(2026, 7, 20);
    const fresh = {
        id: 'fresh', fileId: 'f2', source: 'ig-cache' as const, mediaId: 'fresh-reel',
        analyzedAt: '2026-08-19T00:00:00Z', provider: 'gemini' as const, metrics: metrics(7),
        signals: {
            duration: 30, fps: 30, cutsPerMinute: 10, cutsInFirstThreeSeconds: 1,
            avgShotSeconds: 6, loudnessLufs: -14, silenceCount: 0, isVertical: true, hasAudio: true
        },
        outcome: {
            views: 10, reach: 8, likes: 1, comments: 0, saved: 0, shares: 0, followers: 10000,
            postedAt: '2026-08-17T00:00:00Z', observedAt: '2026-08-19T00:00:00Z'
        }
    };
    assert.equal(buildLabelledReels([fresh], now).length, 0);
});

test('a score that only tracks the calendar does not unlock', () => {
    // reach is driven purely by post date (early reels went big, later ones did
    // not) and the score happens to rise over time. Raw correlation looks strong;
    // controlling for date must collapse it.
    const rows: LabelledReel[] = Array.from({ length: 24 }, (_, i) => ({
        mediaId: `cal${i}`,
        metrics: metrics(1 + Math.floor((i * 9) / 23)),
        signals: { duration: 30, cutsPerMinute: 10, cutsInFirstThreeSeconds: 1, avgShotSeconds: 6, loudnessLufs: -14 },
        reach: 200 * (i + 1),
        postedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
        runs: 1
    }));
    const result = calibrate(rows, WEIGHTS, { iterations: 2000 });
    assert.ok(result.scoreRaw.rho > 0.8, 'uncontrolled correlation should look strong');
    assert.ok(Math.abs(result.score.rho) < 0.5, 'controlling for date should collapse it');
    assert.equal(result.unlocked, false);
});

test('a mixture of two models collapses to the dominant instrument', () => {
    const now = Date.UTC(2026, 7, 20);
    const row = (mediaId: string, model: string, score: number) => ({
        id: `${mediaId}-${model}`, fileId: mediaId, source: 'ig-cache' as const, mediaId,
        analyzedAt: '2026-08-01T00:00:00Z', provider: 'open' as const, providerModel: model,
        metrics: metrics(score),
        signals: {
            duration: 30, fps: 30, cutsPerMinute: 10, cutsInFirstThreeSeconds: 1,
            avgShotSeconds: 6, loudnessLufs: -14, silenceCount: 0, isVertical: true, hasAudio: true
        },
        outcome: {
            views: 100, reach: 80, likes: 5, comments: 1, saved: 1, shares: 1, followers: 10000,
            postedAt: '2026-06-01T00:00:00Z', observedAt: '2026-08-01T00:00:00Z'
        }
    });

    // model-a labelled three reels, model-b only one
    const rows = buildLabelledReels([
        row('r1', 'model-a', 5), row('r2', 'model-a', 6), row('r3', 'model-a', 7),
        row('r4', 'model-b', 2)
    ], now);
    assert.equal(rows.length, 3, 'only the dominant instrument should be used');
    assert.ok(!rows.some(r => r.mediaId === 'r4'));
});

test('forecastFor places a reel in its band, or locks without one', () => {
    const band = (min: number, max: number) => ({ min, max, count: 5, q25: 1, q50: 2, q75: 3, breakouts: 0 });
    const calibration = { signalKey: 'cutsPerMinute', signalBands: [band(0, 0), band(0, 3.3), band(3.4, 21.7)] };
    // A value equal to two bands' max lands in the first: the card's behaviour
    assert.equal(forecastFor(calibration, { cutsPerMinute: 0 }).state, 'low');
    assert.equal(forecastFor(calibration, { cutsPerMinute: 2 }).state, 'mid');
    const high = forecastFor(calibration, { cutsPerMinute: 40 });
    assert.equal(high.state, 'high');
    assert.equal(high.band, high.best);
    assert.equal(forecastFor(calibration, {}).state, 'locked');
    assert.equal(forecastFor({ signalKey: 'cutsPerMinute', signalBands: [] }, { cutsPerMinute: 2 }).state, 'locked');
    assert.equal(forecastFor(undefined, { cutsPerMinute: 2 }).state, 'locked');
});

test('forecastFor: first band low, last band high, every band between mid', () => {
    const band = (min: number, max: number) => ({ min, max, count: 5, q25: 1, q50: 2, q75: 3, breakouts: 0 });
    const states = (bands: ReturnType<typeof band>[], values: number[]) =>
        values.map(v => forecastFor({ signalKey: 'x', signalBands: bands }, { x: v }).state);
    assert.deepEqual(states([band(0, 5), band(6, 10)], [1, 8]), ['low', 'high']);
    assert.deepEqual(states([band(0, 3), band(4, 6), band(7, 9)], [1, 5, 8]), ['low', 'mid', 'high']);
    assert.deepEqual(states([band(0, 3), band(4, 6), band(7, 9), band(10, 12)], [1, 5, 8, 11]), ['low', 'mid', 'mid', 'high']);
});
