// Open-model provider: any OpenAI-compatible endpoint serving open-weight
// vision models — NVIDIA NIM, Groq, OpenRouter :free, or a local Ollama.
// These endpoints can't ingest raw video, so the video is represented as
// evenly sampled frames + an optional Whisper transcript + the measured
// ffmpeg signals. No SDK: plain fetch keeps the dependency count at zero.
//
// Env:
//   OPEN_MODEL_BASE_URL  e.g. https://integrate.api.nvidia.com/v1
//   OPEN_MODEL_API_KEY   bearer key (optional for local Ollama)
//   OPEN_MODEL_ID        e.g. qwen/qwen3.5-vl or meta-llama/llama-4-scout-17b-16e-instruct
//   OPEN_MODEL_LABEL     optional badge text, defaults to OPEN_MODEL_ID
//   WHISPER_API_KEY      enables verbatim transcripts (Groq hosts whisper-large-v3 free)
//   WHISPER_BASE_URL     default https://api.groq.com/openai/v1
//   WHISPER_MODEL        default whisper-large-v3

import { SAMPLE_FRAME_COUNT } from '../constants';
import { extractAudioTrack, extractSampleFrames } from '../signals';
import { parseModelJson } from '../validate';
import { buildPrompt, buildScorePrompt, requestReport, toInsights, withRetries } from './shared';
import type { AIInsights, AnalysisProvider, ProviderInput } from '@/types/analysis';

// Full bilingual reports run ~3-4k output tokens; free endpoints generate
// ~30-40 tok/s, so a complete answer legitimately takes 2-3 minutes. The
// job-polling UI absorbs this — don't cut healthy requests short.
const REQUEST_TIMEOUT_MS = 240 * 1000;
const WHISPER_TIMEOUT_MS = 60 * 1000;
// Reasoning models spend tokens thinking before the JSON, so the default is
// generous — but some endpoints choke on a large max_tokens regardless of what
// they actually generate (NVIDIA nemotron-nano-12b-v2-vl 500s at 8192 and
// answers fine at 3000), hence OPEN_MODEL_MAX_TOKENS.
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
function maxOutputTokens(): number {
    const raw = Number(process.env.OPEN_MODEL_MAX_TOKENS);
    return Number.isFinite(raw) && raw >= 256 ? Math.floor(raw) : DEFAULT_MAX_OUTPUT_TOKENS;
}

interface OpenModelConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    label: string;
    maxFrames: number;
}

export function getOpenModelConfig(): OpenModelConfig | undefined {
    const baseUrl = process.env.OPEN_MODEL_BASE_URL?.trim().replace(/\/+$/, '');
    const model = process.env.OPEN_MODEL_ID?.trim();
    if (!baseUrl || !model) return undefined;
    // Some endpoints cap images per request (Groq: 5) — OPEN_MODEL_MAX_FRAMES adapts
    const maxFramesRaw = Number(process.env.OPEN_MODEL_MAX_FRAMES);
    const maxFrames = Number.isFinite(maxFramesRaw) && maxFramesRaw >= 1
        ? Math.min(12, Math.floor(maxFramesRaw))
        : SAMPLE_FRAME_COUNT;
    return {
        baseUrl,
        apiKey: process.env.OPEN_MODEL_API_KEY?.trim() ?? '',
        model,
        label: process.env.OPEN_MODEL_LABEL?.trim() || model,
        maxFrames
    };
}

export function isOpenModelConfigured(): boolean {
    return Boolean(getOpenModelConfig());
}

// Verbatim speech transcript via an OpenAI-compatible /audio/transcriptions
// endpoint (open-source Whisper on Groq's free tier by default). Optional:
// any failure just means the model judges from frames + signals alone.
async function transcribeAudio(videoPath: string): Promise<string | undefined> {
    const apiKey = process.env.WHISPER_API_KEY?.trim();
    if (!apiKey) return undefined;
    const baseUrl = (process.env.WHISPER_BASE_URL?.trim() || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    const model = process.env.WHISPER_MODEL?.trim() || 'whisper-large-v3';

    const audio = await extractAudioTrack(videoPath);
    if (!audio) return undefined;

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'audio.mp3');
    form.append('model', model);
    form.append('response_format', 'json');

    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS)
    });
    if (!response.ok) {
        throw new Error(`Whisper transcription HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const parsed = await response.json() as { text?: string };
    const text = parsed.text?.trim();
    return text || undefined;
}

function buildMediaIntro(frameCount: number, transcript: string | undefined): string {
    const transcriptBlock = transcript
        ? `a verbatim speech transcript produced by Whisper — treat it as ground truth:\n"""\n${transcript}\n"""`
        : 'NO speech transcript (transcription unavailable) — judge speech-dependent aspects cautiously from on-screen text and the measured signals.';
    return `You cannot watch the full video. Instead you are given:
- ${frameCount} still frames sampled evenly across the video, attached below, each labeled with its timestamp;
- ${transcriptBlock}
Combine the frames, the transcript and the measured signals to reason about motion, pacing and audio you cannot observe directly. Do not invent moments the evidence doesn't support.`;
}

type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string | ContentPart[];
}

interface ChatAnswer {
    text: string;
    truncated: boolean;   // generation stopped at max_tokens
}

async function requestChat(config: OpenModelConfig, messages: ChatMessage[], useResponseFormat: boolean): Promise<ChatAnswer> {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
        },
        body: JSON.stringify({
            model: config.model,
            messages,
            temperature: 0.25,
            max_tokens: maxOutputTokens(),
            ...(useResponseFormat ? { response_format: { type: 'json_object' } } : {})
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
        const body = (await response.text()).slice(0, 300);
        // Some endpoints reject response_format — retry once without it
        if (response.status === 400 && useResponseFormat && /response_format|json_object/i.test(body)) {
            return requestChat(config, messages, false);
        }
        throw new Error(`Open model HTTP ${response.status}: ${body}`);
    }

    const parsed = await response.json() as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
    const choice = parsed.choices?.[0];
    const text = choice?.message?.content;
    if (!text) throw new Error('Open model returned an empty response');
    return { text, truncated: choice?.finish_reason === 'length' };
}

const isParseable = (text: string): boolean => {
    try {
        parseModelJson(text);
        return true;
    } catch {
        return false;
    }
};

export const openCompatProvider: AnalysisProvider = {
    name: 'open',
    async analyze({ videoPath, signals, actual, onStage, scoresOnly }: ProviderInput): Promise<AIInsights> {
        const config = getOpenModelConfig();
        if (!config) throw new Error('OPEN_MODEL_BASE_URL / OPEN_MODEL_ID are not set');

        onStage?.('frames');
        const frames = await extractSampleFrames(videoPath, signals.duration, config.maxFrames);
        if (frames.length === 0) throw new Error('Could not sample frames from the video');

        let transcript: string | undefined;
        if (signals.hasAudio) {
            onStage?.('transcript');
            try {
                transcript = await transcribeAudio(videoPath);
            } catch (error) {
                console.warn('Whisper transcription failed — continuing without transcript:', error);
            }
        }

        const mediaIntro = buildMediaIntro(frames.length, transcript);
        const prompt = scoresOnly
            ? buildScorePrompt(signals, mediaIntro)
            : buildPrompt(signals, actual, mediaIntro);
        const content: ContentPart[] = [
            { type: 'text', text: prompt },
            ...frames.flatMap((frame, i): ContentPart[] => [
                { type: 'text', text: `Frame ${i + 1} — t=${frame.timestamp}s` },
                { type: 'image_url', image_url: { url: frame.dataUrl } }
            ])
        ];
        const label = `Open model (${config.label})`;
        const includeReview = Boolean(actual) && !scoresOnly;

        onStage?.('ai');
        const parsed = await requestReport({
            label,
            scoresOnly: Boolean(scoresOnly),
            expectReview: includeReview,
            ask: async () => {
                const answer = await withRetries(label, () => requestChat(config, [{ role: 'user', content }], true));
                // Cut off at max_tokens: asking again hits the same cap, so fail
                // fast and let the chain fall back to the much shorter scores-only ask
                if (answer.truncated && !isParseable(answer.text)) {
                    throw new Error(`${label} answer was cut off at ${maxOutputTokens()} tokens (OPEN_MODEL_MAX_TOKENS)`);
                }
                return answer.text;
            },
            // Repair rounds are text-only: the frames are not sent again
            repair: async (repairPrompt, previous) => (await withRetries(`${label} repair`, () => requestChat(config, [
                { role: 'user', content: prompt },
                { role: 'assistant', content: previous },
                { role: 'user', content: repairPrompt }
            ], true))).text
        });

        const insights = toInsights(parsed, includeReview);
        // Whisper's text is more verbatim than the model's copy of it
        if (transcript) insights.transcript = transcript;
        return insights;
    }
};

// Friendly, brand-free copy — the raw error is already in the server logs.
// Config problems keep a hint since only the operator ever sees these notes.
export function describeOpenFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/429|quota|rate limit/i.test(message)) {
        return 'Our premium AI reached its daily limit — this report was handled by the backup engine.';
    }
    if (/401|403|API key/i.test(message)) {
        return 'The premium AI rejected its access key (check OPEN_MODEL_API_KEY) — the backup engine handled this report.';
    }
    if (/404/.test(message)) {
        return 'The premium AI model is unavailable (check OPEN_MODEL_ID) — the backup engine handled this report.';
    }
    return 'Our premium AI was busy for a moment — this report was handled by the backup engine.';
}
