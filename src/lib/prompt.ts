// Prompts come from one place: prompts/system.md holds every instruction a
// model or agent reads, as "## Section" bodies with {{placeholders}}. This
// module only picks sections and fills in data. It imports nothing but node:
// modules on purpose, so Node runs it directly and prompt.test.ts can pin the
// scores-only prompt — the calibration instrument — byte for byte.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

// Read on every call: a few KB per analysis, and edits apply without a restart
function loadSections(): Map<string, string> {
    const file = path.join(process.cwd(), 'prompts', 'system.md');
    // A Windows checkout may carry CRLF; the instrument is pinned with LF
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const sections = new Map<string, string>();
    // Anything before the first "## " heading is the file's own notes
    for (const chunk of text.split(/^## /m).slice(1)) {
        const newline = chunk.indexOf('\n');
        const name = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
        const body = newline === -1 ? '' : chunk.slice(newline + 1);
        sections.set(name, body.replace(/<!--[\s\S]*?-->/g, '').trim());
    }
    return sections;
}

function render(names: string[], vars: Record<string, string>): string {
    const sections = loadSections();
    return names.map(name => {
        const body = sections.get(name);
        if (body === undefined) throw new Error(`prompts/system.md has no "## ${name}" section`);
        // A function replacer: data such as transcripts may contain "$" sequences
        return body.replace(PLACEHOLDER, (_match, key: string) => {
            const value = vars[key];
            if (value === undefined) throw new Error(`prompts/system.md: no value for {{${key}}} in "## ${name}"`);
            return value;
        });
    }).join('\n\n');
}

export interface PromptData {
    media: string;     // how this run sees the reel (provider-specific)
    signals: string;   // formatted ffmpeg measurements
}

export type StatsData = Record<'followers' | 'postedAt' | 'views' | 'reach' | 'likes' | 'comments' | 'saved' | 'shares', string>;

/** The full bilingual report. The review sections appear only with real stats. */
export function renderReportPrompt({ media, signals, actual }: PromptData & { actual?: StatsData }): string {
    const withStats = actual ? ['Actual performance'] : [];
    const withReview = actual ? ['Performance review'] : [];
    return render([
        'Role', 'Media', 'Measured signals', ...withStats,
        'Ground rules', 'Metrics', 'Calibration', 'Report fields', 'Language',
        ...withReview, 'Output format'
    ], { media, signals, ...actual });
}

/**
 * Scores only — the calibration instrument. `jsonContract` appends the output
 * line for endpoints without schema enforcement. Pinned by prompt.test.ts.
 */
export function renderScorePrompt({ media, signals }: PromptData, jsonContract: boolean): string {
    return render([
        'Role', 'Media', 'Measured signals', 'Metrics', 'Calibration',
        ...(jsonContract ? ['Scores-only output'] : [])
    ], { media, signals });
}

/** The follow-up turn of a repair round, sent after the model's previous answer. */
export function renderRepairPrompt(errors: string, keys: string[]): string {
    return render(['Repair'], { errors, keys: keys.join(', ') });
}
