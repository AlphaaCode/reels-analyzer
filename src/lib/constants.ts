// Application constants

// File size limits
export const MAX_VIDEO_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB
export const MAX_VIDEO_SIZE_MB = 1024;
export const MAX_VIDEO_SIZE_LABEL = '1GB';

// Duration limits
export const OPTIMAL_MIN_DURATION = 15; // seconds
export const OPTIMAL_MAX_DURATION = 90; // seconds
export const ABSOLUTE_MAX_DURATION = 180; // 3 minutes

// Accepted video formats
export const ACCEPTED_MIME_TYPES = [
    'video/mp4',
    'video/quicktime',
    'video/webm'
] as const;

export const ACCEPTED_EXTENSIONS = ['.mp4', '.mov', '.webm'];

// Analysis weights (must sum to 1.0)
export const METRIC_WEIGHTS = {
    hookStrength: 0.25,      // 25% - Most important
    visualQuality: 0.15,     // 15%
    pacing: 0.20,            // 20%
    trendingElements: 0.15,  // 15%
    engagementCTA: 0.15,     // 15%
    rewatchPotential: 0.10   // 10%
} as const;

// Absolute reach fallback, used only for plain uploads where we don't know the
// account size. Account-blind and optimistic — prefer FOLLOWER_REACH_BANDS.
export const REACH_ESTIMATES: { min: number; max: number; reach: string; engagement: string }[] = [
    { min: 80, max: 100, reach: '100K-500K', engagement: '6.5%-12%' },
    { min: 60, max: 79, reach: '50K-200K', engagement: '4.5%-8%' },
    { min: 40, max: 59, reach: '20K-80K', engagement: '3%-5.5%' },
    { min: 20, max: 39, reach: '5K-30K', engagement: '1.5%-3.5%' },
    { min: 0, max: 19, reach: '1K-10K', engagement: '0.5%-2%' }
];

// Expected reach as a FRACTION OF FOLLOWERS, by virality score. Instagram reach
// rarely exceeds the follower base unless a reel breaks out, so anchoring to the
// account size gives a realistic estimate — and lets the Reality Check verdict
// be a straight "actual reach vs this estimate" comparison (no contradictions).
export const FOLLOWER_REACH_BANDS: { min: number; max: number; lo: number; hi: number }[] = [
    { min: 80, max: 100, lo: 0.70, hi: 1.60 },
    { min: 60, max: 79, lo: 0.40, hi: 0.80 },
    { min: 40, max: 59, lo: 0.20, hi: 0.45 },
    { min: 20, max: 39, lo: 0.09, hi: 0.22 },
    { min: 0, max: 19, lo: 0.03, hi: 0.10 }
];

// Best posting times (based on typical Instagram engagement data)
export const BEST_POST_TIMES = [
    '7:00 PM - 10:00 PM',
    '12:00 PM - 2:00 PM',
    '6:00 AM - 9:00 AM'
];

// Gemini (free tier) settings — key comes from GEMINI_API_KEY in .env.local
export const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash'; // override with GEMINI_MODEL env var

// Open-model provider: frames sampled for vision models that can't ingest raw video
export const SAMPLE_FRAME_COUNT = 8;
export const SAMPLE_FRAME_HEIGHT = 384;      // px — tall enough to read on-screen text

// Local ffmpeg signal extraction
export const SCENE_THRESHOLD = 0.3;          // scene-change sensitivity (0-1)
export const LOUDNESS_TARGET_LUFS = -14;     // platform loudness target
export const SILENCE_NOISE_DB = -30;         // silencedetect noise floor
export const SILENCE_MIN_SECONDS = 1;        // minimum silence span to report
export const HOOK_WINDOW_SECONDS = 3;        // "the hook" = first 3 seconds
export const HOOK_THUMBNAIL_TIMES = [0.5, 1.5, 2.5]; // seconds
export const HOOK_THUMBNAIL_HEIGHT = 256;    // px

// Uploaded videos are a local cache, swept on new uploads
export const UPLOAD_MAX_AGE_HOURS = 24;
export const UPLOAD_KEEP_RECENT = 3; // newest files are never swept, whatever their age
