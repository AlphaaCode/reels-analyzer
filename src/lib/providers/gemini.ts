// Free-tier Gemini provider — the model watches the actual video, audio included.
// Requires GEMINI_API_KEY (free at https://aistudio.google.com/apikey, no credit card).

import { GoogleGenAI, MediaResolution, Type, type Content, type Schema } from '@google/genai';
import { GEMINI_MODEL_DEFAULT } from '../constants';
import { loadReportSchema, type JsonSchema } from '../validate';
import { buildPrompt, buildScorePrompt, requestReport, toInsights, withRetries } from './shared';
import type { AIInsights, AnalysisProvider, ProviderInput } from '@/types/analysis';

const FILE_PROCESSING_TIMEOUT_MS = 3 * 60 * 1000;
const FILE_POLL_INTERVAL_MS = 2000;

const MEDIA_INTRO = 'Watch the attached video carefully, INCLUDING its audio track.';

const GEMINI_TYPES: Record<string, Type> = {
    object: Type.OBJECT,
    array: Type.ARRAY,
    string: Type.STRING,
    integer: Type.INTEGER,
    number: Type.NUMBER,
    boolean: Type.BOOLEAN
};

// schema/report.schema.json in Gemini's dialect. Gemini enforces the structure,
// counts and score ranges while decoding; lengths, patterns and languages are
// left to the validator and its repair rounds.
function toGeminiSchema(node: JsonSchema): Schema {
    return {
        type: GEMINI_TYPES[node.type ?? 'string'],
        ...(node.enum ? { enum: node.enum } : {}),
        ...(node.minimum !== undefined ? { minimum: node.minimum } : {}),
        ...(node.maximum !== undefined ? { maximum: node.maximum } : {}),
        ...(node.minItems !== undefined ? { minItems: String(node.minItems) } : {}),
        ...(node.maxItems !== undefined ? { maxItems: String(node.maxItems) } : {}),
        ...(node.items ? { items: toGeminiSchema(node.items) } : {}),
        ...(node.properties ? {
            properties: Object.fromEntries(Object.entries(node.properties).map(([key, child]) => [key, toGeminiSchema(child)])),
            required: node.required ?? []
        } : {})
    };
}

// The report narrowed to `keys`: the whole report, or only what a repair round sends back
function reportSchema(contract: JsonSchema, keys: string[]): Schema {
    const properties = contract.properties ?? {};
    return toGeminiSchema({
        type: 'object',
        properties: Object.fromEntries(keys.map(key => [key, properties[key]])),
        required: keys
    });
}

export const geminiProvider: AnalysisProvider = {
    name: 'gemini',
    async analyze({ videoPath, mimeType, signals, actual, onStage, scoresOnly }: ProviderInput): Promise<AIInsights> {
        const apiKey = process.env.GEMINI_API_KEY?.trim();
        if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

        // Constructed per-request on purpose: module-scope clients crash `next build`
        const ai = new GoogleGenAI({ apiKey });
        const model = process.env.GEMINI_MODEL?.trim() || GEMINI_MODEL_DEFAULT;
        // Denser frame sampling, high media resolution, and a thinking budget
        // sharpen scoring — gated to the 2.5 family where the params are valid
        const supportsTuning = /2\.5/.test(model);

        onStage?.('ai');
        const uploaded = await ai.files.upload({ file: videoPath, config: { mimeType } });
        try {
            let file = uploaded;
            const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
            while (String(file.state) === 'PROCESSING') {
                if (Date.now() > deadline) throw new Error('Gemini took too long to process the video');
                await new Promise(resolve => setTimeout(resolve, FILE_POLL_INTERVAL_MS));
                file = await ai.files.get({ name: uploaded.name ?? '' });
            }
            if (String(file.state) !== 'ACTIVE') {
                throw new Error(`Gemini could not process the video (state: ${file.state})`);
            }

            const prompt = scoresOnly ? buildScorePrompt(signals, MEDIA_INTRO, false) : buildPrompt(signals, actual, MEDIA_INTRO);
            const includeReview = Boolean(actual) && !scoresOnly;
            const contract = loadReportSchema();

            const generate = async (contents: Content[], responseSchema: Schema): Promise<string> => {
                const response = await withRetries('Gemini generateContent', () => ai.models.generateContent({
                    model,
                    contents,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema,
                        temperature: 0.25,
                        ...(supportsTuning
                            ? {
                                thinkingConfig: { thinkingBudget: 2048 },
                                mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH
                            }
                            : {})
                    }
                }));
                const text = response.text;
                if (!text) throw new Error('Gemini returned an empty response');
                return text;
            };

            const parsed = await requestReport({
                label: 'Gemini',
                scoresOnly: Boolean(scoresOnly),
                expectReview: includeReview,
                ask: () => generate([{
                    role: 'user',
                    parts: [
                        {
                            fileData: { fileUri: file.uri ?? '', mimeType: file.mimeType ?? mimeType },
                            ...(supportsTuning ? { videoMetadata: { fps: 2 } } : {})
                        },
                        { text: prompt }
                    ]
                }], scoresOnly
                    ? toGeminiSchema(contract.properties?.metrics ?? {})
                    // The review is only requested when real stats accompany the video
                    : reportSchema(contract, [...(contract.required ?? []), ...(includeReview ? ['performanceReview'] : [])])),
                // Repair rounds are text-only: the video is not sent again
                repair: (repairPrompt, previous, keys) => generate([
                    { role: 'user', parts: [{ text: prompt }] },
                    { role: 'model', parts: [{ text: previous }] },
                    { role: 'user', parts: [{ text: repairPrompt }] }
                ], reportSchema(contract, keys))
            });
            return toInsights(parsed, includeReview);
        } finally {
            if (uploaded.name) {
                await ai.files.delete({ name: uploaded.name }).catch(() => { /* best effort */ });
            }
        }
    }
};

// Friendly, brand-free copy — the raw error is already in the server logs.
// Config problems keep a hint since only the operator ever sees these notes.
export function describeGeminiFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/RESOURCE_EXHAUSTED|429|quota|rate limit/i.test(message)) {
        return 'The backup AI also reached its daily limit — showing the quick measured-signals estimate. Try again in a few minutes.';
    }
    if (/NOT_FOUND|not found|404/i.test(message)) {
        return 'The backup AI model is unavailable (check GEMINI_MODEL) — showing the quick measured-signals estimate.';
    }
    if (/API key|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(message)) {
        return 'The backup AI rejected its access key (check GEMINI_API_KEY) — showing the quick measured-signals estimate.';
    }
    return 'The backup AI was busy for a moment — showing the quick measured-signals estimate. Try again shortly for the full report.';
}
