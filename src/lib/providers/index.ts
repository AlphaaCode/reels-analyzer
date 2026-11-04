// Provider selection: open-weight model first when configured, Gemini as the
// silent fallback when a key exists, deterministic heuristics always last.

import { geminiProvider } from './gemini';
import { heuristicProvider } from './heuristic';
import { isOpenModelConfigured, openCompatProvider } from './openCompat';
import type { AnalysisProvider } from '@/types/analysis';

export function hasGeminiKey(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
}

// Tried in order; each provider's failure is explained in the providerNote
export function getProviderChain(): AnalysisProvider[] {
    const chain: AnalysisProvider[] = [];
    if (isOpenModelConfigured()) chain.push(openCompatProvider);
    if (hasGeminiKey()) chain.push(geminiProvider);
    chain.push(heuristicProvider);
    return chain;
}

export { geminiProvider, heuristicProvider, openCompatProvider };
