// The full analysis pipeline plus an in-memory job store. Free container hosts
// (Render, Koyeb) sit behind proxies that kill responses after ~100s, and a
// full run (ffmpeg + Gemini video pass) regularly takes longer — so the UI
// starts a job and polls, while /api/analyze keeps the one-shot behavior for
// local use and scripted probes.

import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { extractSignals, extractHookThumbnails } from '@/lib/signals';
import { getProviderChain } from '@/lib/providers';
import { describeGeminiFailure } from '@/lib/providers/gemini';
import { describeOpenFailure, getOpenModelConfig } from '@/lib/providers/openCompat';
import { buildAnalysisResult } from '@/lib/analysis';
import { GEMINI_MODEL_DEFAULT } from '@/lib/constants';
import { recordAnalysis } from '@/lib/history';
import { getCalibration } from '@/lib/calibrationStore';
import { buildLabelledReels } from '@/lib/calibration';
import { readHistory } from '@/lib/history';
import { saveReport } from '@/lib/edit/prepare';
import { igCacheDir, uploadsDir } from '@/lib/paths';
import type { ActualPerformance, AIInsights, AnalysisResult, AnalysisStage, ProviderName, TechnicalSignals } from '@/types/analysis';

const UPLOAD_DIR = uploadsDir();
const IG_CACHE_DIR = igCacheDir();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_BY_EXTENSION: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm'
};

// Carries the HTTP status the one-shot route should answer with
export class AnalysisError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

// Accept real reel stats only when the whole shape is sane
export function parseActual(value: unknown): ActualPerformance | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const v = value as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : NaN);
    const parsed = {
        views: num(v.views),
        reach: num(v.reach),
        likes: num(v.likes),
        comments: num(v.comments),
        saved: num(v.saved),
        shares: num(v.shares),
        followers: num(v.followers),
        postedAt: typeof v.postedAt === 'string' ? v.postedAt : ''
    };
    const counts = [parsed.views, parsed.reach, parsed.likes, parsed.comments, parsed.saved, parsed.shares, parsed.followers];
    if (counts.some(Number.isNaN)) return undefined;
    return parsed;
}

/** An uploaded or cached reel by its fileId: where it is on disk and where the browser can play it. */
export async function findVideo(fileId: unknown): Promise<{ path: string; publicUrl: string; mimeType: string; fromIgCache: boolean }> {
    if (typeof fileId !== 'string' || !UUID_PATTERN.test(fileId)) {
        throw new AnalysisError('Invalid fileId', 400);
    }
    const files = existsSync(UPLOAD_DIR) ? await readdir(UPLOAD_DIR) : [];
    let videoFile = files.find(f => f.startsWith(`${fileId}.`));
    let fromIgCache = false;
    if (!videoFile) {
        // fall back to the cached Instagram reels (ig-cache)
        const igFiles = existsSync(IG_CACHE_DIR) ? await readdir(IG_CACHE_DIR) : [];
        videoFile = igFiles.find(f => f.startsWith(`${fileId}.`) && f.endsWith('.mp4'));
        fromIgCache = videoFile !== undefined;
    }
    if (!videoFile) {
        throw new AnalysisError('Video file not found — please upload it again', 404);
    }

    const extension = videoFile.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) {
        throw new AnalysisError(`Unsupported video format: .${extension}`, 400);
    }
    return {
        path: path.join(fromIgCache ? IG_CACHE_DIR : UPLOAD_DIR, videoFile),
        publicUrl: `/api/media/${fromIgCache ? 'ig-cache' : 'uploads'}/${videoFile}`,
        mimeType,
        fromIgCache
    };
}

export interface PipelineOptions {
    onStage?: (stage: AnalysisStage) => void;
    /** Ask providers for the six scores only — used by calibration labelling. */
    scoresOnly?: boolean;
}

export async function runAnalysisPipeline(
    fileId: unknown,
    actualRaw: unknown,
    options: PipelineOptions = {}
): Promise<AnalysisResult> {
    const { onStage = () => {}, scoresOnly = false } = options;
    const actual = parseActual(actualRaw);

    if (typeof fileId !== 'string' || !UUID_PATTERN.test(fileId)) {
        throw new AnalysisError('Invalid fileId', 400);
    }

    const { path: videoPath, mimeType, fromIgCache } = await findVideo(fileId);
    let signals: TechnicalSignals;
    let thumbnails: string[];
    try {
        onStage('signals');
        signals = await extractSignals(videoPath);
        onStage('thumbs');
        thumbnails = await extractHookThumbnails(videoPath, signals.duration);
    } catch (error) {
        console.error('Signal extraction failed:', error);
        const err = error as { message?: string; stderr?: string; code?: number | string };
        const cause = [err.code, err.stderr?.trim() || err.message]
            .filter(Boolean)
            .join(' — ')
            .slice(0, 300);
        throw new AnalysisError(
            'Could not read this video — it may still be saving or uses an unsupported codec. ' +
            `Wait a moment and try again, or re-export it as MP4 (H.264). [${cause}]`,
            422
        );
    }

    // Try each configured provider in order: open model → Gemini → heuristic.
    // Every fall-through is explained to the user via the providerNote.
    const chain = getProviderChain();
    const failureNotes: string[] = [];
    let providerName: ProviderName = 'heuristic';
    let insights: AIInsights | undefined;
    let mode: 'full' | 'scores' = scoresOnly ? 'scores' : 'full';
    for (const provider of chain) {
        try {
            insights = await provider.analyze({ videoPath, mimeType, signals, actual, onStage, scoresOnly });
            providerName = provider.name;
            break;
        } catch (error) {
            if (provider.name === 'heuristic') throw error;
            console.error(`${provider.name} analysis failed:`, error);
            // The report is far larger than the scores. When a model can reach the
            // endpoint but cannot deliver the whole bilingual report (truncated JSON,
            // output caps), a real score is still worth more than dropping to
            // templates — so ask the same provider for the scores alone.
            if (!scoresOnly) {
                try {
                    insights = await provider.analyze({ videoPath, mimeType, signals, actual, onStage, scoresOnly: true });
                    providerName = provider.name;
                    mode = 'scores';
                    failureNotes.push('The full write-up did not come back, so this report shows scores and measured signals without the AI commentary.');
                    break;
                } catch (scoreError) {
                    console.error(`${provider.name} scores-only retry also failed:`, scoreError);
                }
            }
            failureNotes.push(provider.name === 'gemini' ? describeGeminiFailure(error) : describeOpenFailure(error));
        }
    }
    if (!insights) throw new Error('All analysis providers failed');

    let providerNote: string | undefined = failureNotes.length ? failureNotes.join(' ') : undefined;
    if (providerName === 'heuristic' && !providerNote) {
        providerNote =
            'No AI key set — estimates come from measured signals only. ' +
            'Configure OPEN_MODEL_* (free open-model API) or GEMINI_API_KEY for full AI analysis.';
    }

    onStage('scoring');

    // Every analysis becomes labelled data for the calibration engine.
    // Never let a bookkeeping failure lose the user's actual result.
    try {
        recordAnalysis({
            fileId,
            source: fromIgCache ? 'ig-cache' : 'upload',
            provider: providerName,
            mode,
            providerModel: providerName === 'open'
                ? getOpenModelConfig()?.model
                : providerName === 'gemini'
                    ? (process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT)
                    : undefined,
            metrics: insights.metrics,
            signals,
            actual
        });
    } catch (error) {
        console.error('Could not record analysis history:', error);
    }

    // The edit tab plans from this report: keep it per video (data/reports/{sha256}.json)
    if (mode === 'full') {
        try {
            await saveReport(videoPath, insights);
        } catch (error) {
            console.error('Could not save the report for editing:', error);
        }
    }

    // Recorded above, so this run is already part of what the summary describes
    let calibration;
    try {
        const full = getCalibration();
        if (full) {
            // The signal the bands were built on, so the card's key and bands always agree
            const strongest = full.exploratory.find(e => e.key === full.signalKey);
            const reels = buildLabelledReels(readHistory());
            calibration = {
                n: full.n,
                unlocked: full.unlocked,
                lockReason: full.lockReason,
                alarm: full.alarm,
                rho: full.score.rho,
                p: full.score.p,
                reaches: reels.map(r => r.reach).sort((x, y) => x - y),
                breakoutThreshold: full.breakoutThreshold,
                breakoutCount: reels.filter(r => r.reach >= full.breakoutThreshold).length,
                median: full.overall.q50,
                strongestSignal: strongest ? { key: strongest.key, rho: strongest.rho } : undefined,
                signalBands: full.signalBands
            };
        }
    } catch (error) {
        console.error('Could not build the calibration summary:', error);
    }

    return buildAnalysisResult(insights.metrics, insights, {
        provider: providerName,
        providerModel: providerName === 'open' ? getOpenModelConfig()?.label : undefined,
        providerNote,
        transcript: insights.transcript,
        technical: signals,
        hook: {
            transcript: insights.hookTranscript,
            verdict: insights.hookVerdict,
            cutsInFirstThreeSeconds: signals.cutsInFirstThreeSeconds,
            thumbnails
        },
        suggestedCaption: insights.suggestedCaption,
        hashtags: insights.hashtags,
        metricAdvice: insights.metricAdvice,
        actual,
        performanceReview: insights.performanceReview,
        calibration
    });
}

export interface AnalysisJob {
    status: 'running' | 'done' | 'error';
    stage: AnalysisStage;
    result?: AnalysisResult;
    error?: string;
    createdAt: number;
}

// Results are read exactly once shortly after completion; sweep leftovers
const JOB_TTL_MS = 30 * 60 * 1000;

// globalThis survives dev hot-reload and any per-route module duplication —
// the store must be the same object for /start and /status
const globalStore = globalThis as unknown as { __analysisJobs?: Map<string, AnalysisJob> };
const jobs: Map<string, AnalysisJob> = globalStore.__analysisJobs ?? (globalStore.__analysisJobs = new Map());

function sweepJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of jobs) {
        if (job.createdAt < cutoff) jobs.delete(id);
    }
}

export function startAnalysisJob(fileId: unknown, actualRaw: unknown, scoresOnly = false): string {
    if (typeof fileId !== 'string' || !UUID_PATTERN.test(fileId)) {
        throw new AnalysisError('Invalid fileId', 400);
    }
    sweepJobs();
    const jobId = uuidv4();
    // Mutated in place as the pipeline advances, so /status can report the real stage
    const job: AnalysisJob = { status: 'running', stage: 'signals', createdAt: Date.now() };
    jobs.set(jobId, job);
    runAnalysisPipeline(fileId, actualRaw, { onStage: stage => { job.stage = stage; }, scoresOnly })
        .then(result => {
            Object.assign(job, { status: 'done', result, createdAt: Date.now() });
        })
        .catch((error: unknown) => {
            console.error('Analysis job failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to analyze video';
            Object.assign(job, { status: 'error', error: message, createdAt: Date.now() });
        });
    return jobId;
}

export function getAnalysisJob(jobId: string): AnalysisJob | undefined {
    sweepJobs();
    return jobs.get(jobId);
}
