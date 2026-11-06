// The report contract's checker. Validates what a model or agent wrote
// against schema/report.schema.json plus the rules JSON Schema can't express
// (no emojis, a real English half and a real Arabic half), and drives the
// repair loop that sends the errors back. The edit contract
// (schema/edit-plan.schema.json, src/lib/edit/validate.ts) reuses the same
// engine. It imports nothing but node: modules on purpose, so tools/check.mjs
// and the tests run it directly.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface JsonSchema {
    type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
    properties?: Record<string, JsonSchema>;
    required?: string[];
    items?: JsonSchema;
    minItems?: number;
    maxItems?: number;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    enum?: string[];
    pattern?: string;
    description?: string;
    $ref?: string;
    $defs?: Record<string, JsonSchema>;
    oneOf?: JsonSchema[];
}

export interface Issue {
    path: string;      // JSON pointer, e.g. /strengths/2/ar ("" = the whole answer)
    message: string;
}

export interface Validation {
    errors: Issue[];
    warnings: Issue[];
}

export interface ValidateOptions {
    /** true: real stats were given, performanceReview is required. false: none were, it is ignored. */
    expectReview?: boolean;
    /** Check a scores-only answer: just the six scores, flat. */
    scoresOnly?: boolean;
}

// Every keyword this validator implements. Anything else in the schema fails
// at load time, so the contract can never quietly rely on a rule nobody checks.
const KEYWORDS = new Set([
    '$schema', '$id', '$comment', '$defs', '$ref', 'title', 'description',
    'type', 'properties', 'required', 'items', 'minItems', 'maxItems',
    'minLength', 'maxLength', 'minimum', 'maximum', 'enum', 'pattern', 'oneOf'
]);

// Emoji, pictographs, flags and the invisible emoji modifiers they leave behind
const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{20E3}]/u;
const EMOJI_ALL = new RegExp(EMOJI.source, 'gu');
const LATIN = /\p{Script=Latin}/u;
const ARABIC = /\p{Script=Arabic}/u;

/** Last-resort cleanup for answers that kept an emoji through every repair round. */
export const stripEmoji = (text: string): string =>
    text.replace(EMOJI_ALL, '').replace(/[ \t]{2,}/g, ' ').trim();

/** The top-level report key an issue belongs to: what a repair round sends back. */
export const issueKey = (issue: Issue): string => issue.path.split('/')[1] ?? '';

export const formatIssues = (issues: Issue[]): string =>
    issues.map(issue => `- ${issue.path || '/'}: ${issue.message}`).join('\n');

/** What the checker CLIs print: every error and warning with its path, then the tally. */
export function formatValidation(file: string, { errors, warnings }: Validation): string {
    const tally = `${errors.length} error(s), ${warnings.length} warning(s)`;
    return [
        ...errors.map(issue => `ERROR ${issue.path || '/'}: ${issue.message}`),
        ...warnings.map(issue => `WARN  ${issue.path || '/'}: ${issue.message}`),
        errors.length ? `${file}: ${tally}` : `${file}: OK (${tally})`
    ].join('\n');
}

/** A contract schema from schema/ with every $ref inlined. Throws on keywords this file doesn't implement. */
export function loadSchema(name: string, root = process.cwd()): JsonSchema {
    const file = `schema/${name}`;
    const raw = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as JsonSchema;
    assertKnownKeywords(raw, '#', file);
    return inlineRefs(raw, raw, file);
}

export const loadReportSchema = (root = process.cwd()): JsonSchema => loadSchema('report.schema.json', root);

function assertKnownKeywords(node: JsonSchema, at: string, file: string): void {
    for (const key of Object.keys(node)) {
        if (!KEYWORDS.has(key)) {
            throw new Error(`${file}: unsupported keyword "${key}" at ${at} — implement it in src/lib/validate.ts first`);
        }
    }
    for (const group of ['properties', '$defs'] as const) {
        for (const [name, child] of Object.entries(node[group] ?? {})) assertKnownKeywords(child, `${at}/${group}/${name}`, file);
    }
    if (node.items) assertKnownKeywords(node.items, `${at}/items`, file);
    node.oneOf?.forEach((branch, i) => assertKnownKeywords(branch, `${at}/oneOf/${i}`, file));
}

function inlineRefs(node: JsonSchema, root: JsonSchema, file: string): JsonSchema {
    if (node.$ref) {
        const target = node.$ref.startsWith('#/$defs/') ? root.$defs?.[node.$ref.slice('#/$defs/'.length)] : undefined;
        if (!target) throw new Error(`${file}: cannot resolve $ref ${node.$ref}`);
        const siblings = { ...node };
        delete siblings.$ref;
        return inlineRefs({ ...target, ...siblings }, root, file);
    }
    const rest = { ...node };
    delete rest.$defs;
    return {
        ...rest,
        ...(node.properties ? {
            properties: Object.fromEntries(Object.entries(node.properties).map(([key, child]) => [key, inlineRefs(child, root, file)]))
        } : {}),
        ...(node.items ? { items: inlineRefs(node.items, root, file) } : {}),
        ...(node.oneOf ? { oneOf: node.oneOf.map(branch => inlineRefs(branch, root, file)) } : {})
    };
}

const kindOf = (value: unknown): string =>
    value === null ? 'null'
        : Array.isArray(value) ? 'array'
            : Number.isInteger(value) ? 'integer'
                : typeof value;

// An {en, ar} pair: the shape every bilingual prose field shares
const isLocalized = (node: JsonSchema): boolean =>
    Object.keys(node.properties ?? {}).sort().join() === 'ar,en';

function check(value: unknown, node: JsonSchema, at: string, out: Validation): void {
    const error = (message: string, where = at) => { out.errors.push({ path: where, message }); };

    const kind = kindOf(value);
    if (node.type && kind !== node.type && !(node.type === 'number' && kind === 'integer')) {
        error(`expected ${node.type}, got ${kind}${node.description ? ` — ${node.description}` : ''}`);
        return;
    }
    if (node.enum && !node.enum.includes(value as string)) {
        error(`must be one of ${node.enum.map(option => JSON.stringify(option)).join(', ')}, got ${JSON.stringify(value)}`);
    }

    if (typeof value === 'number') {
        if (node.minimum !== undefined && value < node.minimum) error(`must be at least ${node.minimum}, got ${value}`);
        if (node.maximum !== undefined && value > node.maximum) error(`must be at most ${node.maximum}, got ${value}`);
    }

    if (typeof value === 'string') {
        // Code points, not UTF-16 units: an Arabic letter counts as one character
        const length = [...value].length;
        if (node.minLength !== undefined && length < node.minLength) {
            error(node.minLength === 1 ? 'must not be empty' : `must be at least ${node.minLength} characters`);
        }
        if (node.maxLength !== undefined && length > node.maxLength) {
            error(`is ${length} characters, the limit is ${node.maxLength} — shorten it`);
        }
        if (node.pattern && !new RegExp(node.pattern, 'u').test(value)) error(`must match ${node.pattern}`);
        const emoji = value.match(EMOJI);
        if (emoji) error(`contains an emoji (U+${emoji[0].codePointAt(0)!.toString(16).toUpperCase()}) — remove it`);
    }

    if (Array.isArray(value)) {
        const { minItems, maxItems } = node;
        if (minItems !== undefined && minItems === maxItems) {
            if (value.length !== minItems) error(`must have exactly ${minItems} items, got ${value.length}`);
        } else {
            if (minItems !== undefined && value.length < minItems) error(`must have at least ${minItems} items, got ${value.length}`);
            if (maxItems !== undefined && value.length > maxItems) error(`must have at most ${maxItems} items, got ${value.length}`);
        }
        if (node.items) value.forEach((item, i) => check(item, node.items!, `${at}/${i}`, out));
    }

    if (kind === 'object') {
        const object = value as Record<string, unknown>;
        for (const key of node.required ?? []) {
            if (!(key in object)) error('is missing', `${at}/${key}`);
        }
        for (const [key, child] of Object.entries(object)) {
            const childNode = node.properties?.[key];
            if (childNode) check(child, childNode, `${at}/${key}`, out);
            else if (node.properties) out.warnings.push({ path: `${at}/${key}`, message: 'unknown key, ignored' });
        }
        if (isLocalized(node)) {
            // A half that was copied instead of translated is the common failure
            if (typeof object.en === 'string' && object.en.trim() && !LATIN.test(object.en)) {
                error('must be written in English (no Latin letters found)', `${at}/en`);
            }
            if (typeof object.ar === 'string' && object.ar.trim() && !ARABIC.test(object.ar)) {
                error('must be written in Arabic (no Arabic script found)', `${at}/ar`);
            }
        }
    }

    if (node.oneOf) checkOneOf(value, node.oneOf, at, out);
}

// A branch's tags: its single-value enums, such as an edit op's kind
const tagsOf = (branch: JsonSchema): [string, string][] =>
    Object.entries(branch.properties ?? {})
        .filter(([, child]) => child.enum?.length === 1)
        .map(([key, child]) => [key, child.enum![0]]);

// Exactly one branch must match. When none does, the errors come from the
// branch the value's tags name (an op with kind "cut" is judged as a cut), not
// from every branch at once.
function checkOneOf(value: unknown, branches: JsonSchema[], at: string, out: Validation): void {
    const results = branches.map(branch => {
        const result: Validation = { errors: [], warnings: [] };
        check(value, branch, at, result);
        return result;
    });
    const passed = results.filter(result => result.errors.length === 0);
    if (passed.length === 1) {
        out.warnings.push(...passed[0].warnings);
        return;
    }
    if (passed.length > 1) {
        out.errors.push({ path: at, message: 'matches more than one allowed shape' });
        return;
    }

    const object = kindOf(value) === 'object' ? value as Record<string, unknown> : {};
    const meant = branches.findIndex(branch => {
        const tags = tagsOf(branch);
        return tags.length > 0 && tags.every(([key, tag]) => object[key] === tag);
    });
    if (meant !== -1) {
        out.errors.push(...results[meant].errors);
        out.warnings.push(...results[meant].warnings);
        return;
    }
    const keys = [...new Set(branches.flatMap(branch => tagsOf(branch).map(([key]) => key)))];
    if (keys.length !== 1) {
        out.errors.push({ path: at, message: 'matches none of the allowed shapes' });
        return;
    }
    const [key] = keys;
    const options = branches.flatMap(branch => tagsOf(branch).filter(([name]) => name === key).map(([, tag]) => JSON.stringify(tag)));
    out.errors.push(key in object
        ? { path: `${at}/${key}`, message: `must be one of ${options.join(', ')}, got ${JSON.stringify(object[key])}` }
        : { path: `${at}/${key}`, message: 'is missing' });
}

/** Check any value against a loaded contract schema. */
export function validateValue(value: unknown, schema: JsonSchema): Validation {
    const out: Validation = { errors: [], warnings: [] };
    check(value, schema, '', out);
    return out;
}

/** Check a report (or a scores-only answer) against the contract. */
export function validateReport(value: unknown, schema: JsonSchema, options: ValidateOptions = {}): Validation {
    const out: Validation = { errors: [], warnings: [] };
    if (options.scoresOnly) {
        check(value, schema.properties?.metrics ?? {}, '', out);
        return out;
    }

    let report = value;
    if (report !== null && typeof report === 'object' && !Array.isArray(report)) {
        const has = 'performanceReview' in report;
        if (options.expectReview === true && !has) {
            out.errors.push({ path: '/performanceReview', message: 'is missing — the reel\'s real stats were given, so the review is required' });
        }
        if (options.expectReview === false && has) {
            out.warnings.push({ path: '/performanceReview', message: 'ignored — no real stats were given' });
            const rest = { ...(report as Record<string, unknown>) };
            delete rest.performanceReview;
            report = rest;
        }
    }
    check(report, schema, '', out);
    return out;
}

/** Models occasionally wrap the JSON in fences or prose despite instructions. */
export function parseModelJson(text: string): Record<string, unknown> {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('no JSON object in the answer');
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

export interface RepairRequest {
    previous: string;   // the answer being repaired, as JSON text
    errors: Issue[];
    keys: string[];     // the top-level keys to send back, corrected
}

export interface RepairOptions {
    /** The original request, media included. Also re-asked when an answer can't be parsed at all. */
    ask: () => Promise<string>;
    /** One repair round: previous answer + errors back; the answer holds only the listed keys. */
    repair: (request: RepairRequest) => Promise<string>;
    check: (value: unknown) => Validation;
    /** Keys a text-only repair must never touch: measured scores. */
    isFrozen?: (key: string) => boolean;
    maxRounds?: number;
}

export interface RepairOutcome {
    text: string;
    value?: Record<string, unknown>;   // undefined: no answer ever parsed
    validation: Validation;
    rounds: number;
}

/**
 * Ask, check, and send the errors back up to `maxRounds` times, keeping the
 * best answer seen. A repair round merges only the broken top-level keys into
 * the previous answer, so valid content can't regress. It stops early when a
 * frozen key is broken: a text-only round must not invent a measurement.
 */
export async function validateWithRepair({
    ask,
    repair,
    check: checkValue,
    isFrozen = () => false,
    maxRounds = 2
}: RepairOptions): Promise<RepairOutcome> {
    const read = (text: string): Omit<RepairOutcome, 'rounds'> => {
        try {
            const value = parseModelJson(text);
            return { text, value, validation: checkValue(value) };
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { text, validation: { errors: [{ path: '', message: `not a JSON object (${reason})` }], warnings: [] } };
        }
    };

    let best = read(await ask());
    let rounds = 0;
    while (best.validation.errors.length > 0 && rounds < maxRounds) {
        const keys = [...new Set(best.validation.errors.map(issueKey))];
        if (best.value && keys.some(key => key === '' || isFrozen(key))) break;
        rounds++;
        let next: Omit<RepairOutcome, 'rounds'>;
        try {
            if (!best.value) {
                // Nothing parsed, so nothing to repair: ask the original question again
                next = read(await ask());
            } else {
                const patch = parseModelJson(await repair({ previous: best.text, errors: best.validation.errors, keys }));
                const merged: Record<string, unknown> = { ...best.value };
                for (const key of keys) {
                    if (key in patch) merged[key] = patch[key];
                }
                next = { text: JSON.stringify(merged), value: merged, validation: checkValue(merged) };
            }
        } catch (error) {
            if (!best.value) throw error;
            console.warn('Repair round failed — keeping the best answer so far:', error);
            break;
        }
        if (next.validation.errors.length <= best.validation.errors.length) best = next;
    }
    return { ...best, rounds };
}
