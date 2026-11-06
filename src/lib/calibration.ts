// Calibration engine: does the score actually predict this account's reach?
//
// Deliberately conservative. With a few dozen reels the honest answer is often
// "no measurable relationship", and the app is designed to say so rather than
// dress up noise. Every statistic here is rank-based and permutation-tested,
// because n is small and reach is wildly non-normal (3 to 81,233 in one account).
//
// Pure functions, no imports beyond types — so `node --test` runs this file
// directly and the caller supplies the weights currently in effect.

import type { AnalysisMetrics, MetricKey } from '@/types/analysis';
import type { AnalysisRecord } from '@/lib/history';

export const METRIC_KEYS: MetricKey[] = [
    'hookStrength', 'visualQuality', 'pacing', 'trendingElements', 'engagementCTA', 'rewatchPotential'
];

// A reel keeps accruing reach for days; mixing a fresh reel with a mature one
// makes the young one look like a flop and poisons the correlation.
export const MATURITY_DAYS = 14;
export const MIN_LABELLED = 12;
export const ALPHA = 0.10;
export const PERMUTATIONS = 5000;
export const BREAKOUT_MULTIPLE = 3;   // reach >= 3x the median counts as a breakout

export interface LabelledReel {
    mediaId: string;
    metrics: AnalysisMetrics;
    signals: Record<string, number | null | boolean>;
    reach: number;
    postedAt: string;
    runs: number;                     // how many analyses were merged into this row
}

export interface PredictorResult {
    key: string;
    rho: number;
    p: number;
    pAdjusted?: number;
}

/**
 * Empirical outcome bands for one measured signal — the honest basis for a
 * per-video verdict. Built only for a signal that survived the correction, so
 * the numbers shown to the user rest on a relationship that actually held.
 */
export interface SignalBand {
    min: number;
    max: number;
    count: number;
    q25: number;
    q50: number;
    q75: number;
    breakouts: number;
}

export interface ScoreTier {
    scoreMin: number;
    scoreMax: number;
    count: number;
    q10: number;
    q50: number;
    q90: number;
    breakouts: number;
}

export interface Calibration {
    generatedAt: string;
    n: number;
    target: 'log10Reach';
    weights: Record<MetricKey, number>;
    score: PredictorResult;          // partial: controls for post date
    scoreRaw: PredictorResult;       // uncontrolled, for transparency
    exploratory: PredictorResult[];  // also date-controlled
    survivors: string[];
    unlocked: boolean;
    lockReason?: string;
    alarm?: string;
    tiers: ScoreTier[];
    overall: { min: number; q10: number; q50: number; q90: number; max: number };
    breakoutThreshold: number;
    breakoutRate: number;
    recencyRho: number;
    noiseFloor?: NoiseFloor;
    /** Outcome bands for the strongest surviving signal, if any survived. */
    signalKey?: string;
    signalBands?: SignalBand[];
}

export interface NoiseFloor {
    mediaId: string;
    runs: number;
    metricSpread: Record<string, number>;
    betweenReelSpread: Record<string, number>;
    unusableMetrics: string[];
}

/** Deterministic PRNG so a calibration run is reproducible (and testable). */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Ranks with ties averaged — required for Spearman to stay correct on 1-10 scores. */
export function rank(values: number[]): number[] {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
        let j = i;
        while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
        const shared = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[order[k].index] = shared;
        i = j + 1;
    }
    return ranks;
}

export function pearson(x: number[], y: number[]): number {
    const n = x.length;
    if (n < 3) return 0;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        const a = x[i] - mx, b = y[i] - my;
        num += a * b; dx += a * a; dy += b * b;
    }
    const den = Math.sqrt(dx * dy);
    return den === 0 ? 0 : num / den;
}

export const spearman = (x: number[], y: number[]): number => pearson(rank(x), rank(y));

/**
 * Two-sided permutation p-value. Makes no distributional assumption, which is
 * the point: at n<25 a t-approximation would quietly overstate significance.
 */
export function permutationP(x: number[], y: number[], iterations = PERMUTATIONS, seed = 42): number {
    const observed = Math.abs(spearman(x, y));
    const random = mulberry32(seed);
    const shuffled = [...y];
    let atLeastAsExtreme = 0;
    for (let iteration = 0; iteration < iterations; iteration++) {
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        if (Math.abs(spearman(x, shuffled)) >= observed - 1e-12) atLeastAsExtreme++;
    }
    return (atLeastAsExtreme + 1) / (iterations + 1);
}

/**
 * Spearman correlation of x and y with the influence of `control` removed.
 *
 * This account's reach fell roughly 4x between its high-cadence months and its
 * quiet ones. Without controlling for post date, any predictor that happens to
 * drift over time scores a correlation it has not earned.
 */
export function partialSpearman(x: number[], y: number[], control: number[]): number {
    const xy = spearman(x, y);
    const xz = spearman(x, control);
    const yz = spearman(y, control);
    const denominator = Math.sqrt((1 - xz * xz) * (1 - yz * yz));
    return denominator === 0 ? 0 : (xy - xz * yz) / denominator;
}

/** Permutation p-value for a partial correlation: shuffle y, keep x and the control aligned. */
export function partialPermutationP(
    x: number[], y: number[], control: number[], iterations = PERMUTATIONS, seed = 42
): number {
    const observed = Math.abs(partialSpearman(x, y, control));
    const random = mulberry32(seed);
    const shuffled = [...y];
    let atLeastAsExtreme = 0;
    for (let iteration = 0; iteration < iterations; iteration++) {
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        if (Math.abs(partialSpearman(x, shuffled, control)) >= observed - 1e-12) atLeastAsExtreme++;
    }
    return (atLeastAsExtreme + 1) / (iterations + 1);
}

/** Benjamini-Hochberg adjusted p-values, same order as the input. */
export function benjaminiHochberg(pValues: number[]): number[] {
    const m = pValues.length;
    if (m === 0) return [];
    const sorted = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
    const adjusted = new Array<number>(m);
    let running = 1;
    for (let i = m - 1; i >= 0; i--) {
        running = Math.min(running, (sorted[i].p * m) / (i + 1));
        adjusted[sorted[i].index] = Math.min(1, running);
    }
    return adjusted;
}

export function quantile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export const median = (values: number[]): number => quantile(values, 0.5);

export const weightedScore = (metrics: AnalysisMetrics, weights: Record<MetricKey, number>): number =>
    Math.round(METRIC_KEYS.reduce((sum, key) => sum + metrics[key] * weights[key], 0) * 10);

const logReach = (reach: number): number => Math.log10(Math.max(reach, 1));

export function isMature(postedAt: string, now = Date.now()): boolean {
    const posted = new Date(postedAt).getTime();
    return Number.isFinite(posted) && now - posted >= MATURITY_DAYS * 86400000;
}

function tierFor(scores: number[], reaches: number[], lowerQ: number, upperQ: number, threshold: number): ScoreTier {
    const lo = quantile(scores, lowerQ);
    const hi = quantile(scores, upperQ);
    const inTier = reaches.filter((_, i) => scores[i] >= lo && scores[i] <= hi);
    return {
        scoreMin: Math.round(lo),
        scoreMax: Math.round(hi),
        count: inTier.length,
        q10: Math.round(quantile(inTier, 0.1)),
        q50: Math.round(quantile(inTier, 0.5)),
        q90: Math.round(quantile(inTier, 0.9)),
        breakouts: inTier.filter(reach => reach >= threshold).length
    };
}

/**
 * An instrument is a model AND the prompt that drove it: the scores-only prompt
 * asks a different question than the full report, so the two are not comparable
 * even on the same model.
 */
export const instrumentKey = (record: AnalysisRecord): string =>
    record.providerModel ? `${record.providerModel}:${record.mode ?? 'full'}` : '';

/** The instrument that has labelled the most distinct reels — the one to trust. */
export function dominantInstrument(records: AnalysisRecord[]): string | undefined {
    const reelsPerModel = new Map<string, Set<string>>();
    for (const record of records) {
        if (!record.mediaId || !record.outcome || record.provider === 'heuristic') continue;
        const model = instrumentKey(record);
        if (!model) continue;
        const seen = reelsPerModel.get(model);
        if (seen) seen.add(record.mediaId);
        else reelsPerModel.set(model, new Set([record.mediaId]));
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const [model, seen] of reelsPerModel) {
        if (seen.size > bestCount) { best = model; bestCount = seen.size; }
    }
    return best;
}

/**
 * Records -> one row per published reel.
 * Re-analysing a reel must not double-weight it in the correlation, and the
 * median across runs also cancels part of the model's own variance.
 */
export function buildLabelledReels(records: AnalysisRecord[], now = Date.now(), instrument?: string): LabelledReel[] {
    // Two models score the same video differently, so a set labelled half by one
    // and half by another measures the mixture. Use one instrument: the model
    // that has scored the most reels, unless the caller names one.
    const chosen = instrument ?? dominantInstrument(records);

    const byMedia = new Map<string, AnalysisRecord[]>();
    for (const record of records) {
        // Heuristic scores are a deterministic function of the measured signals,
        // not an opinion about the video — a different instrument again.
        if (!record.mediaId || !record.outcome || record.provider === 'heuristic') continue;
        if (chosen && instrumentKey(record) !== chosen) continue;
        const existing = byMedia.get(record.mediaId);
        if (existing) existing.push(record);
        else byMedia.set(record.mediaId, [record]);
    }

    const reels: LabelledReel[] = [];
    for (const [mediaId, runs] of byMedia) {
        const latest = [...runs].sort((a, b) =>
            (b.outcome?.observedAt ?? '').localeCompare(a.outcome?.observedAt ?? ''))[0];
        const outcome = latest.outcome!;
        if (!isMature(outcome.postedAt, now)) continue;

        const metrics = METRIC_KEYS.reduce((acc, key) => {
            acc[key] = median(runs.map(run => run.metrics[key]));
            return acc;
        }, {} as AnalysisMetrics);

        reels.push({
            mediaId,
            metrics,
            signals: latest.signals as unknown as Record<string, number | null | boolean>,
            reach: outcome.reach,
            postedAt: outcome.postedAt,
            runs: runs.length
        });
    }
    return reels;
}

/**
 * How much does the model disagree with itself on one identical video?
 * A metric whose repeat-run spread swamps the spread between different reels
 * cannot carry a correlation, however tempting its rho looks.
 */
export function measureNoiseFloor(records: AnalysisRecord[], reels: LabelledReel[]): NoiseFloor | undefined {
    const byMedia = new Map<string, AnalysisRecord[]>();
    for (const record of records) {
        // Heuristic runs are deterministic — including them would report zero
        // model noise, which is true of the template and false of the model.
        if (!record.mediaId || record.provider === 'heuristic') continue;
        const existing = byMedia.get(record.mediaId);
        if (existing) existing.push(record);
        else byMedia.set(record.mediaId, [record]);
    }
    let repeated: [string, AnalysisRecord[]] | undefined;
    for (const entry of byMedia) {
        if (entry[1].length >= 2 && (!repeated || entry[1].length > repeated[1].length)) repeated = entry;
    }
    if (!repeated) return undefined;

    const [mediaId, runs] = repeated;
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    const metricSpread: Record<string, number> = {};
    const betweenReelSpread: Record<string, number> = {};
    const unusableMetrics: string[] = [];

    for (const key of METRIC_KEYS) {
        metricSpread[key] = spread(runs.map(run => run.metrics[key]));
        const across = reels.map(reel => reel.metrics[key]);
        betweenReelSpread[key] = across.length >= 2 ? spread(across) : 0;
        if (metricSpread[key] >= betweenReelSpread[key] && betweenReelSpread[key] > 0) unusableMetrics.push(key);
    }

    return {
        mediaId,
        runs: runs.length,
        metricSpread,
        betweenReelSpread,
        unusableMetrics
    };
}

/** Split reels into terciles of one signal and describe each band's real outcomes. */
export function bandsFor(reels: LabelledReel[], key: string, threshold: number): SignalBand[] {
    const usable = reels.filter(reel => typeof reel.signals?.[key] === 'number');
    if (usable.length < 9) return [];
    const sorted = [...usable].sort((a, b) => (a.signals[key] as number) - (b.signals[key] as number));
    const size = Math.floor(sorted.length / 3);
    const slices = [sorted.slice(0, size), sorted.slice(size, size * 2), sorted.slice(size * 2)];
    return slices.map(group => {
        const values = group.map(reel => reel.signals[key] as number);
        const reaches = group.map(reel => reel.reach);
        return {
            min: Math.min(...values),
            max: Math.max(...values),
            count: group.length,
            q25: Math.round(quantile(reaches, 0.25)),
            q50: Math.round(quantile(reaches, 0.5)),
            q75: Math.round(quantile(reaches, 0.75)),
            breakouts: reaches.filter(reach => reach >= threshold).length
        };
    });
}

export function calibrate(
    reels: LabelledReel[],
    weights: Record<MetricKey, number>,
    options: { seed?: number; iterations?: number; noiseFloor?: NoiseFloor } = {}
): Calibration {
    const { seed = 42, iterations = PERMUTATIONS } = options;
    const n = reels.length;
    const reaches = reels.map(reel => reel.reach);
    const targets = reaches.map(logReach);
    const scores = reels.map(reel => weightedScore(reel.metrics, weights));

    const postedRanks = reels.map(reel => new Date(reel.postedAt).getTime());

    // The primary test controls for post date. On an account whose reach shifts
    // over time, an uncontrolled correlation mostly measures the calendar.
    const scoreRho = n >= 3 ? partialSpearman(scores, targets, postedRanks) : 0;
    const scoreP = n >= 3 ? partialPermutationP(scores, targets, postedRanks, iterations, seed) : 1;
    const scoreRawRho = n >= 3 ? spearman(scores, targets) : 0;
    const scoreRawP = n >= 3 ? permutationP(scores, targets, iterations, seed) : 1;

    // Every other candidate predictor is exploratory: reported, BH-corrected,
    // and only allowed to influence weights once it survives the correction.
    const candidates: { key: string; values: number[] }[] = METRIC_KEYS.map(key => ({
        key,
        values: reels.map(reel => reel.metrics[key])
    }));
    for (const key of ['duration', 'cutsPerMinute', 'cutsInFirstThreeSeconds', 'avgShotSeconds', 'loudnessLufs']) {
        const values = reels.map(reel => {
            const value = reel.signals?.[key];
            return typeof value === 'number' ? value : NaN;
        });
        if (values.every(Number.isFinite)) candidates.push({ key, values });
    }

    const exploratory: PredictorResult[] = candidates.map(candidate => ({
        key: candidate.key,
        rho: n >= 3 ? partialSpearman(candidate.values, targets, postedRanks) : 0,
        p: n >= 3 ? partialPermutationP(candidate.values, targets, postedRanks, iterations, seed) : 1
    }));
    const adjusted = benjaminiHochberg(exploratory.map(result => result.p));
    exploratory.forEach((result, index) => { result.pAdjusted = adjusted[index]; });
    const survivors = exploratory.filter(result => (result.pAdjusted ?? 1) < ALPHA).map(result => result.key);

    const threshold = Math.round(median(reaches) * BREAKOUT_MULTIPLE);
    const alarm = n >= MIN_LABELLED && scoreP < ALPHA && scoreRho < 0
        ? 'The score is inversely related to reach on this account — it is currently backwards, not merely uninformative.'
        : undefined;

    // The best measured predictor that cleared the correction — what a verdict can rest on
    const strongestSignal = exploratory
        .filter(result => survivors.includes(result.key) && !METRIC_KEYS.includes(result.key as never))
        .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))[0];

    let lockReason: string | undefined;
    if (n < MIN_LABELLED) lockReason = `Only ${n} mature labelled reels — ${MIN_LABELLED} needed.`;
    else if (scoreP >= ALPHA) lockReason = `No measurable link between score and reach (rho ${scoreRho.toFixed(2)}, p ${scoreP.toFixed(2)}).`;
    else if (scoreRho <= 0) lockReason = 'The measured relationship runs the wrong way.';

    return {
        generatedAt: new Date().toISOString(),
        n,
        target: 'log10Reach',
        weights,
        score: { key: 'score', rho: scoreRho, p: scoreP },
        scoreRaw: { key: 'scoreRaw', rho: scoreRawRho, p: scoreRawP },
        exploratory,
        survivors,
        unlocked: !lockReason,
        lockReason,
        alarm,
        tiers: n >= MIN_LABELLED
            ? [
                tierFor(scores, reaches, 0, 1 / 3, threshold),
                tierFor(scores, reaches, 1 / 3, 2 / 3, threshold),
                tierFor(scores, reaches, 2 / 3, 1, threshold)
            ]
            : [],
        overall: {
            min: Math.min(...reaches),
            q10: Math.round(quantile(reaches, 0.1)),
            q50: Math.round(quantile(reaches, 0.5)),
            q90: Math.round(quantile(reaches, 0.9)),
            max: Math.max(...reaches)
        },
        breakoutThreshold: threshold,
        breakoutRate: reaches.filter(reach => reach >= threshold).length / Math.max(n, 1),
        recencyRho: n >= 3 ? spearman(postedRanks, targets) : 0,
        noiseFloor: options.noiseFloor,
        signalKey: strongestSignal?.key,
        signalBands: strongestSignal ? bandsFor(reels, strongestSignal.key, threshold) : undefined
    };
}

export type ForecastState = 'locked' | 'low' | 'mid' | 'high';

export interface Forecast {
    state: ForecastState;
    signalKey?: string;
    /** The reel's own value on the validated signal. */
    value?: number;
    bandIndex: number;
    band?: SignalBand;
    /** The band with the highest values of the signal. */
    best?: SignalBand;
}

/**
 * Where one reel sits on the validated signal: the band it falls in, as low
 * (first band), high (last band) or mid (any between), or locked when no signal survived (no bands) or the reel has no
 * value for it. The prediction card and the edit job both call this, so they
 * can never disagree.
 */
export function forecastFor(
    calibration: { signalKey?: string; signalBands?: SignalBand[] } | undefined,
    signals: object | undefined
): Forecast {
    const signalKey = calibration?.signalKey;
    const bands = calibration?.signalBands ?? [];
    const raw = signalKey && signals ? (signals as Record<string, unknown>)[signalKey] : undefined;
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    if (!signalKey || value === undefined || bands.length === 0) return { state: 'locked', signalKey, value, bandIndex: -1 };
    const bandIndex = Math.max(0, bands.findIndex((band, i) => value <= band.max || i === bands.length - 1));
    return {
        // First band low, last band high, anything between mid: two bands have no mid
        state: bandIndex === bands.length - 1 ? 'high' : bandIndex === 0 ? 'low' : 'mid',
        signalKey,
        value,
        bandIndex,
        band: bands[bandIndex],
        best: bands[bands.length - 1]
    };
}
