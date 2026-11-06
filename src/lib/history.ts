// Local analysis history — the labelled data the calibration engine learns from.
// Dozens of records, one process, one writer: a JSON file is the whole database.
// Lives in gitignored data/ and never leaves this machine.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { dataRoot, igCacheDir } from '@/lib/paths';
import type { ActualPerformance, AnalysisMetrics, ProviderName, TechnicalSignals } from '@/types/analysis';

const DATA_DIR = path.join(dataRoot(), 'data');
const FILE = path.join(DATA_DIR, 'analyses.json');
const IG_PROFILE = path.join(igCacheDir(), 'profile.json');

// The measured signals worth keeping: deterministic, free, and plausible
// predictors in their own right — the backtest tests them beside the AI's scores.
export interface RecordedSignals {
    duration: number;
    fps: number;
    cutsPerMinute: number;
    cutsInFirstThreeSeconds: number;
    avgShotSeconds: number;
    loudnessLufs: number | null;
    silenceCount: number;
    isVertical: boolean;
    hasAudio: boolean;
}

export interface AnalysisRecord {
    id: string;
    fileId: string;
    source: 'upload' | 'ig-cache';
    mediaId?: string;              // set for published reels — the dedupe and join key
    analyzedAt: string;
    provider: ProviderName;
    providerModel?: string;        // which model scored it — instruments are not interchangeable
    mode?: 'full' | 'scores';     // which prompt produced them — also part of the instrument
    // Raw 1-10 scores, never the weighted total: weights may change, and a stored
    // total would make every past record worthless the moment they do.
    metrics: AnalysisMetrics;
    signals: RecordedSignals;
    outcome?: ActualPerformance & { observedAt: string };
}

export function readHistory(): AnalysisRecord[] {
    if (!existsSync(FILE)) return [];
    try {
        const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
        return Array.isArray(parsed) ? parsed as AnalysisRecord[] : [];
    } catch (error) {
        console.error('History file unreadable — starting empty:', error);
        return [];
    }
}

function writeHistory(records: AnalysisRecord[]): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const temp = `${FILE}.tmp`;
    writeFileSync(temp, JSON.stringify(records, null, 2));
    renameSync(temp, FILE);  // atomic: a crash mid-write cannot truncate the history
}

// Published reels carry their Instagram id in the cache manifest, keyed by fileId
function lookupMediaId(fileId: string): string | undefined {
    if (!existsSync(IG_PROFILE)) return undefined;
    try {
        const profile = JSON.parse(readFileSync(IG_PROFILE, 'utf8')) as { reels?: { fileId: string; mediaId: string }[] };
        return profile.reels?.find(reel => reel.fileId === fileId)?.mediaId;
    } catch {
        return undefined;
    }
}

export function recordAnalysis(input: {
    fileId: string;
    source: 'upload' | 'ig-cache';
    provider: ProviderName;
    providerModel?: string;
    mode?: 'full' | 'scores';
    metrics: AnalysisMetrics;
    signals: TechnicalSignals;
    actual?: ActualPerformance;
}): void {
    const record: AnalysisRecord = {
        id: randomUUID(),
        fileId: input.fileId,
        source: input.source,
        mediaId: lookupMediaId(input.fileId),
        analyzedAt: new Date().toISOString(),
        provider: input.provider,
        providerModel: input.providerModel,
        mode: input.mode,
        metrics: input.metrics,
        signals: {
            duration: input.signals.duration,
            fps: input.signals.fps,
            cutsPerMinute: input.signals.cutsPerMinute,
            cutsInFirstThreeSeconds: input.signals.cutsInFirstThreeSeconds,
            avgShotSeconds: input.signals.avgShotSeconds,
            loudnessLufs: input.signals.loudnessLufs,
            silenceCount: input.signals.silences.length,
            isVertical: input.signals.isVertical,
            hasAudio: input.signals.hasAudio
        },
        outcome: input.actual ? { ...input.actual, observedAt: new Date().toISOString() } : undefined
    };
    writeHistory([...readHistory(), record]);
}
