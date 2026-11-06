// Local, free video signal extraction via ffmpeg/ffprobe — no network, no cost.
// All invocations use execFile with argument arrays (no shell string interpolation).
// Node runs this file directly (the edit engine's tools and tests), so its
// imports are node built-ins, .ts paths and type-only imports.

import { execFile } from 'child_process';
import { promisify } from 'util';
import {
    SCENE_THRESHOLD,
    SILENCE_NOISE_DB,
    SILENCE_MIN_SECONDS,
    HOOK_WINDOW_SECONDS,
    HOOK_THUMBNAIL_TIMES,
    HOOK_THUMBNAIL_HEIGHT,
    SAMPLE_FRAME_COUNT,
    SAMPLE_FRAME_HEIGHT,
    OPTIMAL_MIN_DURATION,
    OPTIMAL_MAX_DURATION
} from './constants.ts';
import type { SilenceSpan, TechnicalSignals } from '@/types/analysis';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

// Explicit binary paths keep analysis working even when the dev server was
// launched from a terminal that doesn't have ffmpeg on its PATH
export const FFMPEG = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH?.trim() || 'ffprobe';

// Freshly uploaded files can be briefly locked/still flushing on Windows — retry reads
async function execFileWithRetry(command: string, args: string[], attempts = 3): Promise<{ stdout: string; stderr: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await execFileAsync(command, args, { maxBuffer: MAX_BUFFER, windowsHide: true });
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 1200));
        }
    }
    throw lastError;
}

interface FfprobeStream {
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    sample_aspect_ratio?: string;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
}

interface FfprobeOutput {
    streams?: FfprobeStream[];
    format?: { duration?: string; bit_rate?: string };
}

function parseFrameRate(rate: string | undefined): number {
    if (!rate) return 0;
    const [num, den] = rate.split('/').map(Number);
    if (!num || !den) return 0;
    return num / den;
}

function reduceAspect(width: number, height: number): string {
    if (!width || !height) return 'unknown';
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}

export interface VideoProbe {
    duration: number;     // seconds, unrounded
    width: number;        // coded size; on screen it is swapped when rotation is ±90
    height: number;
    rotation: number;     // degrees, from the display matrix
    sar: string;          // sample aspect ratio, "1:1" when unset
    fps: number;          // unrounded
    bitrateKbps: number;
    hasVideo: boolean;
    hasAudio: boolean;
}

export async function probeVideo(videoPath: string): Promise<VideoProbe> {
    const { stdout } = await execFileWithRetry(
        FFPROBE,
        ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath]
    );
    const probe = JSON.parse(stdout) as FfprobeOutput;
    const video = probe.streams?.find(s => s.codec_type === 'video');
    const sar = video?.sample_aspect_ratio ?? '';
    return {
        duration: parseFloat(probe.format?.duration ?? '') || 0,
        width: video?.width ?? 0,
        height: video?.height ?? 0,
        rotation: video?.side_data_list?.find(data => typeof data.rotation === 'number')?.rotation
            ?? (Number(video?.tags?.rotate) || 0),
        sar: /^[1-9]\d*:[1-9]\d*$/.test(sar) ? sar : '1:1',
        fps: parseFrameRate(video?.avg_frame_rate) || parseFrameRate(video?.r_frame_rate),
        bitrateKbps: Math.round((parseInt(probe.format?.bit_rate ?? '', 10) || 0) / 1000),
        hasVideo: Boolean(video),
        hasAudio: Boolean(probe.streams?.some(s => s.codec_type === 'audio'))
    };
}

export async function extractSignals(videoPath: string): Promise<TechnicalSignals> {
    const { duration, width, height, fps, bitrateKbps, hasVideo, hasAudio } = await probeVideo(videoPath);

    const cuts = hasVideo && duration > 0 ? await detectSceneCuts(videoPath) : [];
    const { loudnessLufs, silences } = hasAudio
        ? await analyzeAudio(videoPath)
        : { loudnessLufs: null, silences: [] as SilenceSpan[] };

    const cutCount = cuts.length;

    return {
        duration: Math.round(duration * 10) / 10,
        width,
        height,
        fps: Math.round(fps * 10) / 10,
        aspectRatio: reduceAspect(width, height),
        isVertical: height > 0 && Math.abs(width / height - 9 / 16) < 0.05,
        bitrateKbps,
        hasAudio,
        loudnessLufs,
        cutCount,
        cutsPerMinute: duration > 0 ? Math.round((cutCount / (duration / 60)) * 10) / 10 : 0,
        avgShotSeconds: duration > 0 ? Math.round((duration / (cutCount + 1)) * 100) / 100 : 0,
        cutsInFirstThreeSeconds: cuts.filter(t => t <= HOOK_WINDOW_SECONDS).length,
        silences,
        durationFit: duration < OPTIMAL_MIN_DURATION ? 'short' : duration > OPTIMAL_MAX_DURATION ? 'long' : 'optimal'
    };
}

// select + metadata=print logs each detected scene change's pts_time to stderr
async function detectSceneCuts(videoPath: string): Promise<number[]> {
    const { stderr } = await execFileAsync(
        FFMPEG,
        [
            '-hide_banner', '-i', videoPath,
            '-vf', `select='gt(scene,${SCENE_THRESHOLD})',metadata=print`,
            '-an', '-f', 'null', '-'
        ],
        { maxBuffer: MAX_BUFFER, windowsHide: true }
    );
    return [...stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)]
        .map(match => Math.round(parseFloat(match[1]) * 100) / 100);
}

// One audio decode pass: silence spans + integrated loudness (EBU R128).
// The edit engine asks for shorter silences than the signals report.
export async function analyzeAudio(
    videoPath: string,
    minSilenceSeconds = SILENCE_MIN_SECONDS
): Promise<{ loudnessLufs: number | null; silences: SilenceSpan[] }> {
    const { stderr } = await execFileAsync(
        FFMPEG,
        [
            '-hide_banner', '-i', videoPath,
            '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${minSilenceSeconds},ebur128`,
            '-vn', '-f', 'null', '-'
        ],
        { maxBuffer: MAX_BUFFER, windowsHide: true }
    );

    const loudnessMatches = [...stderr.matchAll(/I:\s*(-?[0-9]+(?:\.[0-9]+)?)\s+LUFS/g)];
    const loudnessLufs = loudnessMatches.length
        ? parseFloat(loudnessMatches[loudnessMatches.length - 1][1])
        : null;

    const starts = [...stderr.matchAll(/silence_start:\s*(-?[0-9]+(?:\.[0-9]+)?)/g)].map(m => parseFloat(m[1]));
    const ends = [...stderr.matchAll(/silence_end:\s*(-?[0-9]+(?:\.[0-9]+)?)/g)].map(m => parseFloat(m[1]));
    const silences: SilenceSpan[] = starts.map((start, i) => ({
        start: Math.max(0, Math.round(start * 10) / 10),
        end: Math.round((ends[i] ?? start) * 10) / 10
    }));

    return { loudnessLufs, silences };
}

export interface SampledFrame {
    timestamp: number;  // seconds into the video
    dataUrl: string;    // base64 JPEG data URL
}

// Evenly spaced stills across the whole video — the input for open vision
// models that can't ingest raw video the way Gemini's Files API does
export async function extractSampleFrames(
    videoPath: string,
    duration: number,
    count = SAMPLE_FRAME_COUNT
): Promise<SampledFrame[]> {
    if (duration <= 0) return [];
    const frames: SampledFrame[] = [];

    for (let i = 0; i < count; i++) {
        const timestamp = Math.round(((i + 0.5) / count) * duration * 10) / 10;
        try {
            const { stdout } = await execFileAsync(
                FFMPEG,
                [
                    '-hide_banner', '-loglevel', 'error',
                    '-ss', String(timestamp), '-i', videoPath,
                    '-frames:v', '1',
                    '-vf', `scale=-2:${SAMPLE_FRAME_HEIGHT}`,
                    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', '-'
                ],
                { encoding: 'buffer', maxBuffer: MAX_BUFFER, windowsHide: true }
            );
            if (stdout.length > 0) {
                frames.push({ timestamp, dataUrl: `data:image/jpeg;base64,${stdout.toString('base64')}` });
            }
        } catch {
            // frame at this timestamp unavailable — skip it
        }
    }

    return frames;
}

// Mono 16 kHz MP3 of the audio track, piped out — small enough for the free
// speech-to-text APIs (a 3-minute reel is ~1 MB at 48 kbps)
export async function extractAudioTrack(videoPath: string): Promise<Buffer | null> {
    try {
        const { stdout } = await execFileAsync(
            FFMPEG,
            [
                '-hide_banner', '-loglevel', 'error',
                '-i', videoPath,
                '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
                '-f', 'mp3', 'pipe:1'
            ],
            { encoding: 'buffer', maxBuffer: MAX_BUFFER, windowsHide: true }
        );
        return stdout.length > 0 ? stdout : null;
    } catch {
        return null; // no audio stream or encode failure — transcript is optional
    }
}

// Small JPEG thumbnails from the hook window, piped straight out of ffmpeg
export async function extractHookThumbnails(videoPath: string, duration: number): Promise<string[]> {
    const times = HOOK_THUMBNAIL_TIMES.filter(t => duration === 0 || t < duration);
    const thumbnails: string[] = [];

    for (const time of times) {
        try {
            const { stdout } = await execFileAsync(
                FFMPEG,
                [
                    '-hide_banner', '-loglevel', 'error',
                    '-ss', String(time), '-i', videoPath,
                    '-frames:v', '1',
                    '-vf', `scale=-2:${HOOK_THUMBNAIL_HEIGHT}`,
                    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'
                ],
                { encoding: 'buffer', maxBuffer: MAX_BUFFER, windowsHide: true }
            );
            if (stdout.length > 0) {
                thumbnails.push(`data:image/jpeg;base64,${stdout.toString('base64')}`);
            }
        } catch {
            // frame at this timestamp unavailable — skip it
        }
    }

    return thumbnails;
}
