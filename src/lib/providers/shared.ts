// Pieces shared by the AI providers (Gemini and any OpenAI-compatible open
// model): retry policy, the data that fills the prompts, the contract round
// trip (check the answer, send errors back), and the defensive normalization
// that turns the checked JSON into AIInsights. Every instruction the models
// read lives in prompts/system.md, rendered by ../prompt.

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import {
    LOUDNESS_TARGET_LUFS,
    OPTIMAL_MIN_DURATION,
    OPTIMAL_MAX_DURATION
} from '../constants';
import { dataRoot } from '../paths';
import { renderRepairPrompt, renderReportPrompt, renderScorePrompt } from '../prompt';
import {
    formatIssues,
    issueKey,
    loadReportSchema,
    stripEmoji,
    validateReport,
    validateWithRepair
} from '../validate';
import type {
    ActualPerformance,
    AIInsights,
    LocalizedText,
    PerformanceReview,
    TechnicalSignals
} from '@/types/analysis';

// Retry the model call on transient server errors before giving up
const GENERATE_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 5000, 9000];

// 503 overloaded / 500 internal / network blips are worth retrying.
// 429 quota, bad key, and missing-model are NOT — retrying wastes time.
export function isTransient(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (/RESOURCE_EXHAUSTED|429|quota|rate limit/i.test(message)) return false;
    if (/API key|API_KEY_INVALID|PERMISSION_DENIED|401|403|NOT_FOUND|404/i.test(message)) return false;
    return /50[0-9]|UNAVAILABLE|INTERNAL|overloaded|high demand|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

export async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < GENERATE_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === GENERATE_RETRIES - 1 || !isTransient(error)) throw error;
            const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
            console.warn(`${label}: transient error, retry ${attempt + 1}/${GENERATE_RETRIES - 1} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

export function formatSignals(s: TechnicalSignals): string {
    const silences = s.silences.length
        ? s.silences.map(span => `${span.start}s–${span.end}s`).join(', ')
        : 'none';
    return [
        `- Duration: ${s.duration}s (${s.durationFit}; optimal window ${OPTIMAL_MIN_DURATION}–${OPTIMAL_MAX_DURATION}s)`,
        `- Resolution: ${s.width}x${s.height} (${s.aspectRatio}${s.isVertical ? ', vertical — correct for Reels' : ' — NOT vertical 9:16'}), ${s.fps} fps, ${s.bitrateKbps} kbps`,
        `- Hard cuts: ${s.cutCount} total → ${s.cutsPerMinute}/min, avg shot ${s.avgShotSeconds}s, ${s.cutsInFirstThreeSeconds} cut(s) in the first 3s`,
        `- Integrated loudness: ${s.loudnessLufs === null ? 'no audio track' : `${s.loudnessLufs} LUFS (platform target ≈ ${LOUDNESS_TARGET_LUFS} LUFS)`}`,
        `- Silence spans ≥${1}s: ${silences}`
    ].join('\n');
}

/**
 * Scores only — no prose, no bilingual fields, a couple of hundred output tokens.
 * Endpoints that cannot emit the full report can still produce this, and it is
 * what the calibration engine actually needs. Scored in 'scores' mode, which is
 * tracked separately from 'full' because a different prompt is a different
 * instrument even on the same model; src/lib/prompt.test.ts pins its exact text.
 * `jsonContract` appends the output line for endpoints without schema enforcement.
 */
export function buildScorePrompt(
    signals: TechnicalSignals,
    mediaIntro: string,
    jsonContract = true
): string {
    return renderScorePrompt({ media: mediaIntro, signals: formatSignals(signals) }, jsonContract);
}

// The full analysis prompt. `mediaIntro` describes what the model is looking at
// (attached video for Gemini; sampled frames + Whisper transcript for open
// models). The review sections are included only when real stats are known.
export function buildPrompt(
    signals: TechnicalSignals,
    actual: ActualPerformance | undefined,
    mediaIntro: string
): string {
    return renderReportPrompt({
        media: mediaIntro,
        signals: formatSignals(signals),
        actual: actual && {
            followers: actual.followers.toLocaleString(),
            postedAt: actual.postedAt,
            views: String(actual.views),
            reach: String(actual.reach),
            likes: String(actual.likes),
            comments: String(actual.comments),
            saved: String(actual.saved),
            shares: String(actual.shares)
        }
    });
}

// The last full report as a model wrote it (after any repairs), so
// `node tools/check.mjs data/last-report.json` runs on a real answer
const LAST_REPORT_FILE = path.join(dataRoot(), 'data', 'last-report.json');

function saveLastReport(report: Record<string, unknown>): void {
    try {
        mkdirSync(path.dirname(LAST_REPORT_FILE), { recursive: true });
        writeFileSync(LAST_REPORT_FILE, JSON.stringify(report, null, 2));
    } catch (error) {
        // A debugging copy must never cost the user their analysis
        console.warn('Could not save data/last-report.json:', error);
    }
}

export interface ReportRequest {
    label: string;
    scoresOnly: boolean;
    /** Real stats were sent, so performanceReview is required. */
    expectReview: boolean;
    /** The original request, media included. */
    ask: () => Promise<string>;
    /** A text-only follow-up turn after `previous`; the answer must hold only `keys`. */
    repair: (prompt: string, previous: string, keys: string[]) => Promise<string>;
}

/**
 * One contract round trip: ask, check the answer against
 * schema/report.schema.json, send the errors back up to twice, and return the
 * best answer. Scores are measurements, so a text-only round never repairs
 * them: invalid scores fail the provider, and the chain then asks for
 * scores-only with the media attached. Prose errors that survive both rounds
 * are logged and rendered defensively by toInsights.
 */
export async function requestReport({ label, scoresOnly, expectReview, ask, repair }: ReportRequest): Promise<Record<string, unknown>> {
    const schema = loadReportSchema();
    const outcome = await validateWithRepair({
        ask,
        check: value => validateReport(value, schema, { scoresOnly, expectReview }),
        repair: ({ previous, errors, keys }) => repair(renderRepairPrompt(formatIssues(errors), keys), previous, keys),
        isFrozen: key => scoresOnly || key === 'metrics'
    });

    const { errors } = outcome.validation;
    if (!outcome.value) {
        throw new Error(`${label} answered without a JSON object: ${errors[0]?.message ?? 'empty answer'}`);
    }
    const scoreErrors = scoresOnly ? errors : errors.filter(issue => issueKey(issue) === 'metrics');
    if (scoreErrors.length > 0) {
        throw new Error(`${label} returned invalid scores:\n${formatIssues(scoreErrors)}`);
    }
    if (outcome.rounds > 0) console.info(`${label}: ${outcome.rounds} repair round(s)`);
    if (errors.length > 0) {
        console.warn(`${label}: contract errors left after repairs — rendering defensively:\n${formatIssues(errors)}`);
    }
    if (!scoresOnly) saveLastReport(outcome.value);
    return outcome.value;
}

export const clampScore = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Math.min(10, Math.max(1, Number.isFinite(n) ? Math.round(n) : 5));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string').map(stripEmoji).filter(v => v.length > 0)
        : [];

export const asOptionalString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const text = stripEmoji(value);
    return text.length > 0 ? text : undefined;
};

export const asLocalized = (value: unknown): LocalizedText => {
    // Open models occasionally emit a plain string where {en, ar} was asked —
    // carry it in both halves rather than dropping the content
    if (typeof value === 'string') {
        const text = stripEmoji(value);
        return { en: text, ar: text };
    }
    const v = (value ?? {}) as { en?: unknown; ar?: unknown };
    const en = typeof v.en === 'string' ? stripEmoji(v.en) : '';
    const ar = typeof v.ar === 'string' ? stripEmoji(v.ar) : '';
    // If the model dropped one half, mirror the other so the UI never goes blank
    return { en: en || ar, ar: ar || en };
};

export const asLocalizedArray = (value: unknown): LocalizedText[] =>
    Array.isArray(value) ? value.map(asLocalized).filter(text => text.en || text.ar) : [];

export const orUndefined = (text: LocalizedText): LocalizedText | undefined =>
    text.en || text.ar ? text : undefined;

function normalizeReview(value: unknown): PerformanceReview {
    const v = (value ?? {}) as Record<string, unknown>;
    const verdict = v.verdict === 'overperformed' || v.verdict === 'underperformed'
        ? v.verdict
        : 'as-expected';
    return {
        verdict,
        whyItHappened: asLocalizedArray(v.whyItHappened),
        whatToDoNext: asLocalizedArray(v.whatToDoNext)
    };
}

// Map the checked answer onto AIInsights. The contract was enforced upstream;
// this still tolerates leftovers so a half-broken answer renders, never crashes.
export function toInsights(parsed: Record<string, unknown>, includeReview: boolean): AIInsights {
    // Full reports nest the six scores; a scores-only answer is the six scores
    const scores = isRecord(parsed.metrics) ? parsed.metrics : parsed;
    const adviceRaw = (parsed.metricAdvice ?? {}) as Record<string, unknown>;
    const review = includeReview ? normalizeReview(parsed.performanceReview) : undefined;

    return {
        metrics: {
            hookStrength: clampScore(scores.hookStrength),
            visualQuality: clampScore(scores.visualQuality),
            pacing: clampScore(scores.pacing),
            trendingElements: clampScore(scores.trendingElements),
            engagementCTA: clampScore(scores.engagementCTA),
            rewatchPotential: clampScore(scores.rewatchPotential)
        },
        strengths: asLocalizedArray(parsed.strengths),
        improvements: asLocalizedArray(parsed.improvements),
        summary: asLocalized(parsed.summary),
        recommendations: asLocalizedArray(parsed.recommendations),
        transcript: asOptionalString(parsed.transcript),
        hookTranscript: asOptionalString(parsed.hookTranscript),
        hookVerdict: orUndefined(asLocalized(parsed.hookVerdict)),
        suggestedCaption: orUndefined(asLocalized(parsed.suggestedCaption)),
        hashtags: asStringArray(parsed.hashtags),
        metricAdvice: {
            hookStrength: asLocalizedArray(adviceRaw.hookStrength),
            visualQuality: asLocalizedArray(adviceRaw.visualQuality),
            pacing: asLocalizedArray(adviceRaw.pacing),
            trendingElements: asLocalizedArray(adviceRaw.trendingElements),
            engagementCTA: asLocalizedArray(adviceRaw.engagementCTA),
            rewatchPotential: asLocalizedArray(adviceRaw.rewatchPotential)
        },
        // A review without reasons explains nothing: hide the panel instead
        performanceReview: review && review.whyItHappened.length > 0 ? review : undefined
    };
}
