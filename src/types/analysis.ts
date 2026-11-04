// Analysis types for AI-powered virality scoring

export interface AnalysisMetrics {
    hookStrength: number;      // 1-10: First 3 seconds engagement
    visualQuality: number;     // 1-10: Composition, colors, clarity
    pacing: number;            // 1-10: Narrative rhythm, retention
    trendingElements: number;  // 1-10: Trending audio/formats
    engagementCTA: number;     // 1-10: Call-to-action clarity
    rewatchPotential: number;  // 1-10: Shareability, replay value
}

export type MetricKey = keyof AnalysisMetrics;

// A piece of AI-written text carried in both app languages
export interface LocalizedText {
    en: string;
    ar: string;
}

export type PerformanceVerdict = 'overperformed' | 'as-expected' | 'underperformed';

// Real lifetime stats of an Instagram reel, sent with the analyze request
export interface ActualPerformance {
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saved: number;
    shares: number;
    followers: number;
    postedAt: string;
}

// The AI's reconciliation of prediction vs. reality
export interface PerformanceReview {
    verdict: PerformanceVerdict;
    whyItHappened: LocalizedText[];
    whatToDoNext: LocalizedText[];
}

// Per-metric, per-video improvement tips shown in the metric popup
export type MetricAdvice = Partial<Record<MetricKey, LocalizedText[]>>;

export type ProviderName = 'open' | 'gemini' | 'heuristic';

// Pipeline phases a running job reports, in order — the UI shows where the
// wait actually is instead of guessing on a timer
export type AnalysisStage = 'signals' | 'thumbs' | 'frames' | 'transcript' | 'ai' | 'scoring';

export interface SilenceSpan {
    start: number; // seconds
    end: number;   // seconds
}

// Deterministic signals measured locally with ffmpeg/ffprobe — free and offline
export interface TechnicalSignals {
    duration: number;
    width: number;
    height: number;
    fps: number;
    aspectRatio: string;               // e.g. "9:16"
    isVertical: boolean;               // close enough to 9:16 for Reels
    bitrateKbps: number;
    hasAudio: boolean;
    loudnessLufs: number | null;       // integrated loudness; null when no audio
    cutCount: number;
    cutsPerMinute: number;
    avgShotSeconds: number;
    cutsInFirstThreeSeconds: number;
    silences: SilenceSpan[];           // near-silence spans >= 1s
    durationFit: 'short' | 'optimal' | 'long';
}

export interface HookAnalysis {
    transcript?: string;               // speech/on-screen text in the first 3 seconds (verbatim)
    verdict?: LocalizedText;           // one-line assessment of the hook
    cutsInFirstThreeSeconds: number;
    thumbnails: string[];              // base64 data URLs sampled from the hook window
}

// What an AI (or heuristic) provider returns for a video
export interface AIInsights {
    metrics: AnalysisMetrics;
    strengths: LocalizedText[];
    improvements: LocalizedText[];
    summary: LocalizedText;
    recommendations: LocalizedText[];
    transcript?: string;               // verbatim, spoken language
    hookTranscript?: string;           // verbatim, spoken language
    hookVerdict?: LocalizedText;
    suggestedCaption?: LocalizedText;
    hashtags?: string[];
    metricAdvice?: MetricAdvice;
    performanceReview?: PerformanceReview;
}

export interface ProviderInput {
    videoPath: string;
    mimeType: string;
    signals: TechnicalSignals;
    actual?: ActualPerformance;
    onStage?: (stage: AnalysisStage) => void;
    // Ask only for the six scores: a couple of hundred output tokens instead of
    // several thousand, so weak endpoints can serve it and a failed report call
    // can fall back to it. A different prompt, so tracked as its own instrument.
    scoresOnly?: boolean;
}

export interface AnalysisProvider {
    name: ProviderName;
    analyze(input: ProviderInput): Promise<AIInsights>;
}

export interface AnalysisResult {
    viralityScore: number;     // 1-100 weighted score
    metrics: AnalysisMetrics;
    recommendations: LocalizedText[];
    estimatedReach: string;    // e.g., "20K-150K"
    engagementRate: string;    // e.g., "3.2%-8.5%"
    bestPostTime: string;      // e.g., "7:00 PM - 10:00 PM"
    summary: LocalizedText;
    strengths: LocalizedText[];
    improvements: LocalizedText[];
    provider: ProviderName;
    providerModel?: string;    // open-model label shown in the badge (e.g. "Qwen3-VL")
    providerNote?: string;     // e.g. rate-limit fallback explanation
    transcript?: string;       // full speech transcript (Gemini only, verbatim)
    technical?: TechnicalSignals;
    hook?: HookAnalysis;
    suggestedCaption?: LocalizedText;
    hashtags?: string[];
    metricAdvice?: MetricAdvice;
    actual?: ActualPerformance;
    performanceReview?: PerformanceReview;
    /** What this account's own history says the score is worth. Undefined until any reel is labelled. */
    calibration?: CalibrationSummary;
}

/** The slice of the calibration the UI needs — the full object stays server-side. */
export interface CalibrationSummary {
    n: number;
    unlocked: boolean;
    lockReason?: string;
    alarm?: string;
    rho: number;
    p: number;
    reaches: number[];            // every labelled reel's reach, for the strip plot
    breakoutThreshold: number;
    breakoutCount: number;
    median: number;
    strongestSignal?: { key: string; rho: number };
    /** Real outcome bands for that signal — what makes a defensible verdict possible. */
    signalBands?: { min: number; max: number; count: number; q25: number; q50: number; q75: number; breakouts: number }[];
}

export interface AnalyzeRequest {
    fileId: string;
    actual?: ActualPerformance;
}

export interface AnalyzeResponse {
    success: boolean;
    data?: AnalysisResult;
    error?: string;
}

// Async analysis job endpoints (deployed UIs poll instead of one long call)
export interface AnalyzeStartResponse {
    success: boolean;
    jobId?: string;
    error?: string;
}

export interface AnalyzeStatusResponse {
    success: boolean;
    status?: 'running' | 'done' | 'error' | 'unknown';
    stage?: AnalysisStage;
    data?: AnalysisResult;
    error?: string;
}

export type ViralLevel = 'very-high' | 'high' | 'medium' | 'low' | 'very-low';

export const VIRAL_LEVELS: Record<ViralLevel, { min: number; max: number; label: string }> = {
    'very-high': { min: 80, max: 100, label: 'Very High' },
    'high': { min: 60, max: 79, label: 'High' },
    'medium': { min: 40, max: 59, label: 'Medium' },
    'low': { min: 20, max: 39, label: 'Low' },
    'very-low': { min: 1, max: 19, label: 'Very Low' }
};

export function getViralLevel(score: number): { level: ViralLevel; label: string } {
    if (score >= 80) return { level: 'very-high', ...VIRAL_LEVELS['very-high'] };
    if (score >= 60) return { level: 'high', ...VIRAL_LEVELS['high'] };
    if (score >= 40) return { level: 'medium', ...VIRAL_LEVELS['medium'] };
    if (score >= 20) return { level: 'low', ...VIRAL_LEVELS['low'] };
    return { level: 'very-low', ...VIRAL_LEVELS['very-low'] };
}
