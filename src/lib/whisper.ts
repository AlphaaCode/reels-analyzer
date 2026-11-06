// Speech to text through any OpenAI-compatible /audio/transcriptions endpoint
// (open-source Whisper on Groq's free tier by default). The analysis uses the
// plain transcript; the edit engine asks for word timestamps too.
//
// Env:
//   WHISPER_API_KEY   enables it; without a key nothing is sent
//   WHISPER_BASE_URL  default https://api.groq.com/openai/v1
//   WHISPER_MODEL     default whisper-large-v3

import { extractAudioTrack } from './signals.ts';

const WHISPER_TIMEOUT_MS = 60 * 1000;

export interface Word {
    text: string;
    start: number;   // seconds
    end: number;
}

export interface Transcription {
    text: string;
    language?: string;
    words: Word[];   // empty unless word timestamps were asked for
}

/** Undefined when no key is set or the video has no audio. Throws when the endpoint fails. */
export async function transcribe(videoPath: string, withWords = false): Promise<Transcription | undefined> {
    const apiKey = process.env.WHISPER_API_KEY?.trim();
    if (!apiKey) return undefined;
    const baseUrl = (process.env.WHISPER_BASE_URL?.trim() || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    const model = process.env.WHISPER_MODEL?.trim() || 'whisper-large-v3';

    const audio = await extractAudioTrack(videoPath);
    if (!audio) return undefined;

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', model);
    form.append('response_format', withWords ? 'verbose_json' : 'json');
    if (withWords) form.append('timestamp_granularities[]', 'word');

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`Whisper transcription HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const parsed = await response.json() as {
        text?: string;
        language?: string;
        words?: { word?: string; start?: number; end?: number }[];
    };
    if (withWords && !Array.isArray(parsed.words)) {
        throw new Error('Whisper returned no word timestamps (the endpoint may not support timestamp_granularities)');
    }
    return {
        text: parsed.text?.trim() ?? '',
        language: parsed.language,
        words: (parsed.words ?? [])
            .map(word => ({ text: word.word?.trim() ?? '', start: Number(word.start), end: Number(word.end) }))
            .filter(word => word.text && Number.isFinite(word.start) && word.end > word.start)
    };
}
