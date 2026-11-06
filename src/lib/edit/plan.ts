// What an edit plan (schema/edit-plan.schema.json) does to the timeline, as
// pure functions. The checker and the renderer both call these, so they can
// never disagree about what a plan keeps, in which order, or how long the
// result runs. Times are source seconds except hookText's (output seconds).

import type { LocalizedText } from '@/types/analysis';
import type { ForecastState } from '../calibration.ts';
import type { Word } from '../whisper.ts';
import type { WordTrack } from './words.ts';

interface OpBase {
    reason: LocalizedText;
    finding: string;    // JSON pointer into report.json
}

export type CutOp = OpBase & { kind: 'cut'; start: number; end: number };
export type TrimSilenceOp = OpBase & { kind: 'trimSilence'; minGapSec: number; keepSec: number };
export type RehookOp = OpBase & { kind: 'rehook'; fromSec: number; toSec: number; mode: 'tease' | 'move' };
export type HookTextOp = OpBase & {
    kind: 'hookText';
    text: LocalizedText;
    start: number;
    end: number;
    position: 'top' | 'center' | 'bottom';
};
export type LoudnormOp = OpBase & { kind: 'loudnorm'; targetLufs: number };
export type CaptionsOp = OpBase & { kind: 'captions'; style: 'bold' | 'clean' };
export type PunchInOp = OpBase & { kind: 'punchIn'; at: number; durationSec: number; scale: number };
export type EditOp = CutOp | TrimSilenceOp | RehookOp | HookTextOp | LoudnormOp | CaptionsOp | PunchInOp;

export interface EditPlan {
    sourceSha256: string;
    reportRef: string;
    forecastState: ForecastState;
    language: 'en' | 'ar';
    ops: EditOp[];
}

export interface Span {
    start: number;
    end: number;
}

/** A piece of the source the output plays, in output order. */
export interface Segment extends Span {
    scale: number;      // punch-in zoom; 1 = none
    tease: boolean;     // part of the rehook line played at the opening
}

export interface Timeline {
    segments: Segment[];
    duration: number;   // output seconds
}

// Slivers left between two removals are dropped: under 3 frames at 30 fps
const MIN_SEGMENT_SECONDS = 0.1;

export const opsOf = <K extends EditOp['kind']>(plan: EditPlan, kind: K): Extract<EditOp, { kind: K }>[] =>
    plan.ops.filter((op): op is Extract<EditOp, { kind: K }> => op.kind === kind);

const lasts = (span: Span): boolean => span.end - span.start >= MIN_SEGMENT_SECONDS;

function subtract(spans: Span[], removed: Span[]): Span[] {
    return removed.reduce((kept, cut) => kept.flatMap(span => [
        { start: span.start, end: Math.min(span.end, cut.start) },
        { start: Math.max(span.start, cut.end), end: span.end }
    ].filter(piece => piece.end > piece.start)), spans);
}

const intersect = (spans: Span[], window: Span): Span[] => spans
    .map(span => ({ start: Math.max(span.start, window.start), end: Math.min(span.end, window.end) }))
    .filter(span => span.end > span.start);

/** Silences in the source: the time between words, or detected silences when there are no words. */
export function silenceGaps(track: WordTrack, duration: number): Span[] {
    if (track.words.length === 0) return track.silences;
    const gaps: Span[] = [];
    let cursor = 0;
    for (const word of [...track.words].sort((a, b) => a.start - b.start)) {
        if (word.start > cursor) gaps.push({ start: cursor, end: word.start });
        cursor = Math.max(cursor, word.end);
    }
    if (duration > cursor) gaps.push({ start: cursor, end: duration });
    return gaps;
}

/** What trimSilence takes out: every long enough silence but keepSec of it, half next to the speech on each side. */
export function silenceRemovals(track: WordTrack, duration: number, { minGapSec, keepSec }: TrimSilenceOp): Span[] {
    const half = keepSec / 2;
    return silenceGaps(track, duration)
        .filter(gap => gap.end - gap.start >= minGapSec)
        .map(gap => ({ start: gap.start <= 0 ? 0 : gap.start + half, end: gap.end >= duration ? duration : gap.end - half }))
        .filter(span => span.end > span.start);
}

/** The source pieces the output plays, in order: removals out, the rehook line first, punch-ins marked. */
export function planTimeline(plan: EditPlan, duration: number, track: WordTrack): Timeline {
    const removed = [
        ...opsOf(plan, 'cut'),
        ...opsOf(plan, 'trimSilence').flatMap(op => silenceRemovals(track, duration, op))
    ];
    const kept = subtract([{ start: 0, end: duration }], removed).filter(lasts);

    const [rehook] = opsOf(plan, 'rehook');
    const line = rehook && { start: rehook.fromSec, end: Math.min(rehook.toSec, duration) };
    const tease = line ? intersect(kept, line).filter(lasts) : [];
    const main = line && rehook.mode === 'move' ? subtract(kept, [line]).filter(lasts) : kept;

    const zooms = opsOf(plan, 'punchIn').map(op => ({ start: op.at, end: op.at + op.durationSec, scale: op.scale }));
    const segments = [
        ...tease.flatMap(span => zoomed(span, zooms, true)),
        ...main.flatMap(span => zoomed(span, zooms, false))
    ];
    return { segments, duration: segments.reduce((sum, segment) => sum + segment.end - segment.start, 0) };
}

// Split a span where punch-ins start and end, so each piece plays at one zoom
function zoomed(span: Span, zooms: (Span & { scale: number })[], tease: boolean): Segment[] {
    const edges = [span.start];
    for (const t of zooms.flatMap(zoom => [zoom.start, zoom.end]).sort((a, b) => a - b)) {
        if (t - edges[edges.length - 1] >= MIN_SEGMENT_SECONDS && span.end - t >= MIN_SEGMENT_SECONDS) edges.push(t);
    }
    edges.push(span.end);
    return edges.slice(1).map((end, i) => {
        const start = edges[i];
        const middle = (start + end) / 2;
        const scale = zooms.find(zoom => zoom.start <= middle && middle < zoom.end)?.scale ?? 1;
        return { start, end, scale, tease };
    });
}

export interface OutputWord extends Word {
    tease: boolean;
}

/** Each word where it plays in the output: gone when cut, twice when a tease repeats it. */
export function outputWords(segments: Segment[], words: Word[]): OutputWord[] {
    const placed: OutputWord[] = [];
    let offset = 0;
    for (const segment of segments) {
        for (const word of words) {
            const middle = (word.start + word.end) / 2;
            if (middle < segment.start || middle >= segment.end) continue;
            placed.push({
                text: word.text,
                start: offset + Math.max(word.start, segment.start) - segment.start,
                end: offset + Math.min(word.end, segment.end) - segment.start,
                tease: segment.tease
            });
        }
        offset += segment.end - segment.start;
    }
    return placed;
}
