// Word timestamps for the edit engine: where each spoken word starts and ends,
// so cuts and a rehook land between words and captions follow the speech.
// Whisper supplies them (src/lib/whisper.ts), cached per video in
// data/words/{sha256}.json. With no key, a failed request or no speech, the
// track falls back to detected silences: enough to trim pauses, not enough for
// rehook or captions, which the checker then refuses with the reason.

import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyzeAudio } from '../signals.ts';
import { transcribe, type Word } from '../whisper.ts';
import type { SilenceSpan } from '@/types/analysis';

export interface WordTrack {
    source: 'whisper' | 'silence';
    words: Word[];              // empty in the silence fallback
    silences: SilenceSpan[];    // the fallback's pauses; unused when there are words
    unavailable?: string;       // why there are no words, so no rehook and no captions
}

// Pauses between phrases run far shorter than the 1 s silences the signals report
const FALLBACK_MIN_SILENCE_SECONDS = 0.3;

export async function sha256File(file: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

export async function getWords(
    videoPath: string,
    { sha256, hasAudio, cacheDir }: { sha256: string; hasAudio: boolean; cacheDir: string }
): Promise<WordTrack> {
    if (!hasAudio) return { source: 'silence', words: [], silences: [], unavailable: 'the video has no audio track' };

    const cacheFile = path.join(cacheDir, `${sha256}.json`);
    let words = readCache(cacheFile);
    let reason = 'Whisper heard no speech';
    if (!words) {
        try {
            const result = await transcribe(videoPath, true);
            if (result) {
                words = result.words;
                mkdirSync(cacheDir, { recursive: true });
                writeFileSync(cacheFile, JSON.stringify({ sha256, language: result.language, words }, null, 2));
            } else {
                // transcribe() sends nothing without a key or when it can't read the audio
                reason = process.env.WHISPER_API_KEY?.trim() ? 'the audio track could not be read' : 'WHISPER_API_KEY is not set';
            }
        } catch (error) {
            // Not cached: the next run asks again
            reason = `Whisper failed (${error instanceof Error ? error.message : String(error)})`;
        }
    }
    if (words?.length) return { source: 'whisper', words, silences: [] };

    const { silences } = await analyzeAudio(videoPath, FALLBACK_MIN_SILENCE_SECONDS);
    return { source: 'silence', words: [], silences, unavailable: reason };
}

function readCache(file: string): Word[] | undefined {
    try {
        const { words } = JSON.parse(readFileSync(file, 'utf8')) as { words?: Word[] };
        return Array.isArray(words) ? words : undefined;
    } catch {
        return undefined;   // missing or unreadable: ask Whisper again
    }
}
