// The edit contract's checker: schema/edit-plan.schema.json plus the rules a
// schema can't express, checked against the video itself (its hash, length,
// audio and word timestamps). Same Issue paths and CLI output as the report
// checker: node tools/check-edit.mjs <edit-plan.json> <video>.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { ForecastState } from '../calibration.ts';
import { probeVideo, type VideoProbe } from '../signals.ts';
import { loadReportSchema, loadSchema, validateValue, type JsonSchema, type Validation } from '../validate.ts';
import { planTimeline, silenceRemovals, type EditOp, type EditPlan, type Span } from './plan.ts';
import { getWords, sha256File, type WordTrack } from './words.ts';

export interface EditContext {
    videoPath: string;
    sha256: string;
    probe: VideoProbe;
    track: WordTrack;
    /** The job's forecast.json state, when the plan was written in a job folder. */
    forecast?: ForecastState;
}

/** The state in forecast.json beside the plan, if there is one: the plan must match it. */
export function readForecastBeside(planFile: string): ForecastState | undefined {
    const file = path.join(path.dirname(planFile), 'forecast.json');
    if (!existsSync(file)) return undefined;
    return (JSON.parse(readFileSync(file, 'utf8')) as { state: ForecastState }).state;
}

/** What the rules need to know about the source. Word timestamps come from the cache, Whisper or silences unless given. */
export async function loadEditContext(
    videoPath: string,
    { root = process.cwd(), track }: { root?: string; track?: WordTrack } = {}
): Promise<EditContext> {
    const [sha256, probe] = await Promise.all([sha256File(videoPath), probeVideo(videoPath)]);
    return {
        videoPath,
        sha256,
        probe,
        track: track ?? await getWords(videoPath, { sha256, hasAudio: probe.hasAudio, cacheDir: path.join(root, 'data', 'words') })
    };
}

// Edges may miss by this much: plans are written from rounded signals and Whisper's estimates
const SLACK_SECONDS = 0.05;
const MIN_OUTPUT_SECONDS = 3;
const AT_MOST_ONE: EditOp['kind'][] = ['trimSilence', 'rehook', 'hookText', 'loudnorm', 'captions'];
const CLASHES = new Set(['cut/cut', 'cut/rehook', 'rehook/cut', 'punchIn/punchIn']);

const seconds = (t: number): string => `${Math.round(t * 100) / 100} s`;
const overlaps = (a: Span, b: Span): boolean => a.start < b.end - SLACK_SECONDS && b.start < a.end - SLACK_SECONDS;

/** True when the pointer names a field report.json can have, e.g. /improvements/2 or /metricAdvice/pacing/0. */
function pointsInto(schema: JsonSchema, pointer: string): boolean {
    let node: JsonSchema | undefined = schema;
    for (const token of pointer.split('/').slice(1)) {
        node = node?.type === 'array'
            ? (/^\d+$/.test(token) && Number(token) < (node.maxItems ?? Infinity) ? node.items : undefined)
            : node?.properties?.[token];
    }
    return node !== undefined;
}

export function validateEditPlan(value: unknown, context: EditContext, root = process.cwd()): Validation {
    const result = validateValue(value, loadSchema('edit-plan.schema.json', root));
    // The rules below read the plan's fields, so they need a well-formed plan
    if (result.errors.length) return result;

    const error = (at: string, message: string) => { result.errors.push({ path: at, message }); };
    const warn = (at: string, message: string) => { result.warnings.push({ path: at, message }); };
    const plan = value as EditPlan;
    const { duration, hasAudio, hasVideo } = context.probe;
    const { words, unavailable } = context.track;
    const report = loadReportSchema(root);

    if (!hasVideo) error('', 'the source has no video stream');
    if (plan.sourceSha256 !== context.sha256) {
        error('/sourceSha256', `does not match the video (${context.sha256}): the plan was written for another file`);
    }

    const withinVideo = (at: string, startKey: string, endKey: string, start: number, end: number) => {
        if (end <= start) error(`${at}/${endKey}`, `must be after ${startKey}`);
        else if (end > duration + SLACK_SECONDS) error(`${at}/${endKey}`, `is past the end of the video (${seconds(duration)})`);
    };
    const betweenWords = (at: string, t: number) => {
        const word = words.find(w => w.start + SLACK_SECONDS < t && t < w.end - SLACK_SECONDS);
        if (word) error(at, `falls inside the word "${word.text}" (${seconds(word.start)} to ${seconds(word.end)}); move it to a word edge`);
    };
    const needsWords = (at: string) => error(at, `needs word timestamps, which are unavailable: ${unavailable}`);

    if (context.forecast && plan.forecastState !== context.forecast) {
        error('/forecastState', `is ${plan.forecastState}, but forecast.json says ${context.forecast}`);
    }

    const first = new Map<string, number>();
    const spans: { i: number; kind: string; span: Span }[] = [];
    plan.ops.forEach((op, i) => {
        const at = `/ops/${i}`;
        if (!pointsInto(report, op.finding)) error(`${at}/finding`, `${op.finding} is not a report.json field (schema/report.schema.json)`);
        if (AT_MOST_ONE.includes(op.kind)) {
            if (first.has(op.kind)) error(at, `only one ${op.kind} is allowed; the first is /ops/${first.get(op.kind)}`);
            else first.set(op.kind, i);
        }

        switch (op.kind) {
            case 'cut':
                withinVideo(at, 'start', 'end', op.start, op.end);
                betweenWords(`${at}/start`, op.start);
                betweenWords(`${at}/end`, op.end);
                spans.push({ i, kind: op.kind, span: op });
                break;
            case 'rehook':
                withinVideo(at, 'fromSec', 'toSec', op.fromSec, op.toSec);
                if (!words.length) needsWords(at);
                if (context.forecast && context.forecast !== 'low') {
                    error(at, `a rehook is only for a reel in the low band; this one is ${context.forecast}`);
                }
                betweenWords(`${at}/fromSec`, op.fromSec);
                betweenWords(`${at}/toSec`, op.toSec);
                spans.push({ i, kind: op.kind, span: { start: op.fromSec, end: op.toSec } });
                break;
            case 'punchIn':
                if (op.at + op.durationSec > duration + SLACK_SECONDS) error(`${at}/durationSec`, `runs past the end of the video (${seconds(duration)})`);
                spans.push({ i, kind: op.kind, span: { start: op.at, end: op.at + op.durationSec } });
                break;
            case 'hookText':
                // Its end is checked against the edited length below
                if (op.end <= op.start) error(`${at}/end`, 'must be after start');
                break;
            case 'trimSilence':
                if (op.keepSec >= op.minGapSec) error(`${at}/keepSec`, 'must be shorter than minGapSec');
                else if (!hasAudio) error(at, 'needs an audio track');
                else if (silenceRemovals(context.track, duration, op).length === 0) {
                    warn(at, `finds no silence of ${seconds(op.minGapSec)} or longer, so it changes nothing`);
                }
                break;
            case 'loudnorm':
                if (!hasAudio) error(at, 'needs an audio track');
                break;
            case 'captions':
                if (!words.length) needsWords(at);
                break;
        }
    });

    spans.forEach((later, b) => spans.slice(0, b).forEach(earlier => {
        if (CLASHES.has(`${earlier.kind}/${later.kind}`) && overlaps(earlier.span, later.span)) {
            error(`/ops/${later.i}`, `overlaps the ${earlier.kind} at /ops/${earlier.i}`);
        }
    }));
    if (!words.length && plan.ops.some(op => op.kind === 'cut')) {
        warn('/ops', `cut edges were not checked against words: ${unavailable}`);
    }

    // The edited length is only meaningful once every op is sound
    if (result.errors.length) return result;
    const edited = planTimeline(plan, duration, context.track).duration;
    if (edited < MIN_OUTPUT_SECONDS) {
        error('/ops', `leave ${seconds(edited)} of video; an edit must leave at least ${seconds(MIN_OUTPUT_SECONDS)}`);
    }
    plan.ops.forEach((op, i) => {
        if (op.kind === 'hookText' && op.end > edited + SLACK_SECONDS) {
            error(`/ops/${i}/end`, `is past the end of the edited video (${seconds(edited)})`);
        }
    });
    return result;
}
