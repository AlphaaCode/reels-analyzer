// Renders a checked edit plan with ffmpeg, then measures the result with the
// same signals an analysis uses. A model only ever writes the plan; everything
// here is deterministic. The source is only read: the edit goes to
// exports/{sha256}-{n}.mp4 beside its plan and its measured before/after diff,
// and ffmpeg runs with -n, so no existing file is ever overwritten.
//
// One filter graph per render: per-segment trim/atrim (cuts, trimmed silence,
// the rehook line first), scale+crop for punch-ins, concat, then hook text and
// captions burned from an .ass file by libass (which shapes Arabic; drawtext
// does not) and two-pass loudnorm.

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { extractSignals, FFMPEG, type VideoProbe } from '../signals.ts';
import { formatIssues } from '../validate.ts';
import type { Word } from '../whisper.ts';
import { opsOf, outputWords, planTimeline, type EditPlan, type OutputWord, type Segment } from './plan.ts';
import { validateEditPlan, type EditContext } from './validate.ts';
import type { TechnicalSignals } from '@/types/analysis';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

const LATIN_FONT = 'Noto Sans';
const ARABIC_FONT = 'Noto Sans Arabic';
// The platforms' -1 dBTP ceiling, and room for speech over music (loudnorm's
// default LRA of 7 forces most speech into dynamic mode). Linear gain needs
// peaks within 13 dB of the loudness and a measurable range (short clips
// measure an LRA of 0); anything else gets loudnorm's dynamic mode, which can
// land short of the target. The diff shows what it reached.
const LOUDNORM_LIMITS = 'TP=-1:LRA=11';

/** What the diff compares: measured on both files, never predicted. */
export type MeasuredSignals = Pick<TechnicalSignals,
    'duration' | 'cutCount' | 'cutsPerMinute' | 'cutsInFirstThreeSeconds' | 'loudnessLufs' | 'silences'>;

/** An export's id is its base name: {sha256}-{n}. */
export const EXPORT_ID_PATTERN = /^[0-9a-f]{64}-\d+$/;

/** A file of one export inside outDir, or undefined for anything that isn't an export id (no traversal). */
export function exportFile(outDir: string, id: unknown, suffix: '.mp4' | '.plan.json' | '.diff.json'): string | undefined {
    if (typeof id !== 'string' || !EXPORT_ID_PATTERN.test(id)) return undefined;
    const file = path.resolve(outDir, `${id}${suffix}`);
    return path.dirname(file) === path.resolve(outDir) ? file : undefined;
}

export interface RenderOutput {
    video: string;      // exports/{sha256}-{n}.mp4
    plan: string;       // the plan as rendered
    diff: string;       // measured before/after
    before: MeasuredSignals;
    after: MeasuredSignals;
}

export async function renderEdit(
    plan: EditPlan,
    context: EditContext,
    { root = process.cwd(), outDir = path.join(root, 'exports') }: { root?: string; outDir?: string } = {}
): Promise<RenderOutput> {
    const { errors } = validateEditPlan(plan, context, root);
    if (errors.length) throw new Error(`The edit plan has errors:\n${formatIssues(errors)}`);

    const { videoPath, sha256, probe, track } = context;
    // Edges on whole frames, so each segment's audio runs exactly as long as its video
    const fps = probe.fps || 30;
    const snap = (t: number) => Math.round(t * fps) / fps;
    const segments = planTimeline(plan, probe.duration, track).segments
        .map(segment => ({ ...segment, start: snap(segment.start), end: snap(segment.end) }))
        .filter(segment => segment.end > segment.start);
    const frame = displayFrame(probe);

    const base = reserve(outDir, sha256, plan);
    const video = `${base}.mp4`;
    const work = mkdtempSync(path.join(tmpdir(), 'reel-edit-'));
    try {
        const { inputs, chains } = segmentGraph(videoPath, segments, probe);
        const videoFilters: string[] = [];
        const audioFilters: string[] = [];

        const subtitles = writeSubtitles(plan, segments, track.words, frame, work);
        if (subtitles) {
            videoFilters.push(`subtitles=filename=${filterPath(subtitles)}:fontsdir=${filterPath(path.join(root, 'assets', 'fonts'))}`);
        }
        const [loudnorm] = opsOf(plan, 'loudnorm');
        if (loudnorm) {
            const target = `I=${loudnorm.targetLufs}:${LOUDNORM_LIMITS}`;
            const m = await measureLoudness(inputs, chains(false), target);
            audioFilters.push(`loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}`
                + `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`,
                // loudnorm stamps the frames after its final flush up to 100 ms late; the samples are right, so restamp from them
                'asetpts=N/SR/TB');
        }

        const graph = [
            ...chains(true),
            ...(videoFilters.length ? [`[vc]${videoFilters.join(',')}[vout]`] : []),
            ...(audioFilters.length ? [`[ac]${audioFilters.join(',')}[aout]`] : [])
        ].join(';');
        await execFileAsync(FFMPEG, [
            '-hide_banner', '-nostdin', '-v', 'error', '-n',
            ...inputs,
            '-filter_complex', graph,
            '-map', videoFilters.length ? '[vout]' : '[vc]',
            ...(probe.hasAudio ? ['-map', audioFilters.length ? '[aout]' : '[ac]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            video
        ], { maxBuffer: MAX_BUFFER, windowsHide: true });
    } catch (error) {
        // The number was reserved for this render, so whatever sits under it is ours
        for (const file of [video, `${base}.plan.json`]) rmSync(file, { force: true });
        throw error;
    } finally {
        rmSync(work, { recursive: true, force: true });
    }

    const [before, after] = (await Promise.all([extractSignals(videoPath), extractSignals(video)])).map(measured);
    const diff = `${base}.diff.json`;
    writeFileSync(diff, JSON.stringify({
        sourceSha256: sha256,
        video: path.basename(video),
        plan: path.basename(`${base}.plan.json`),
        before,
        after
    }, null, 2));
    return { video, plan: `${base}.plan.json`, diff, before, after };
}

const measured = (signals: TechnicalSignals): MeasuredSignals => ({
    duration: signals.duration,
    cutCount: signals.cutCount,
    cutsPerMinute: signals.cutsPerMinute,
    cutsInFirstThreeSeconds: signals.cutsInFirstThreeSeconds,
    loudnessLufs: signals.loudnessLufs,
    silences: signals.silences
});

// The next free {sha256}-{n}, claimed by creating its plan file exclusively
function reserve(outDir: string, sha256: string, plan: EditPlan): string {
    mkdirSync(outDir, { recursive: true });
    const taken = readdirSync(outDir)
        .filter(name => name.startsWith(`${sha256}-`))
        .map(name => parseInt(name.slice(sha256.length + 1), 10))
        .filter(Number.isFinite);
    for (let n = Math.max(0, ...taken) + 1; ; n++) {
        const base = path.join(outDir, `${sha256}-${n}`);
        try {
            writeFileSync(`${base}.plan.json`, JSON.stringify(plan, null, 2), { flag: 'wx' });
            return base;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
    }
}

// Frames leave the decoder already rotated, so this is the size they arrive at
function displayFrame(probe: VideoProbe): { width: number; height: number } {
    const turned = Math.abs(probe.rotation) % 180 === 90;
    return turned ? { width: probe.height, height: probe.width } : { width: probe.width, height: probe.height };
}

const num = (t: number): string => t.toFixed(3);
const even = (x: number): number => 2 * Math.ceil(x / 2);

// ffmpeg unescapes a path inside a filtergraph twice: as an option value
// (\ ' :), then as graph text (\ ' [ ] , ;)
const escapeWith = (text: string, chars: string) => text.replace(new RegExp(`[${chars}]`, 'g'), c => `\\${c}`);
const filterPath = (file: string): string =>
    escapeWith(escapeWith(file.replace(/\\/g, '/'), "\\\\':"), "\\\\'\\[\\],;");

// The inputs and the chains up to concat, which ends in [vc] (when withVideo) and [ac].
// The rehook line comes from a second input seeked straight to it: read from
// the first, ffmpeg would hold every frame decoded before the line in memory.
function segmentGraph(videoPath: string, segments: Segment[], probe: VideoProbe) {
    const tease = segments.filter(segment => segment.tease);
    const teaseFrom = tease.length ? tease[0].start : 0;
    const inputs = tease.length
        ? ['-i', videoPath, '-ss', num(teaseFrom), '-t', num(tease[tease.length - 1].end - teaseFrom), '-i', videoPath]
        : ['-i', videoPath];
    const { width, height } = displayFrame(probe);
    const sar = probe.sar.replace(':', '/');

    const chains = (withVideo: boolean): string[] => {
        const lines: string[] = [];
        const pads: string[] = [];
        segments.forEach((segment, k) => {
            const input = segment.tease ? 1 : 0;
            const offset = segment.tease ? teaseFrom : 0;
            const range = `start=${num(segment.start - offset)}:end=${num(segment.end - offset)}`;
            if (withVideo) {
                const zoom = segment.scale === 1 ? ''
                    : `,scale=${even(width * segment.scale)}:${even(height * segment.scale)},crop=${width}:${height}`;
                lines.push(`[${input}:v]trim=${range},setpts=PTS-STARTPTS${zoom},setsar=${sar}[v${k}]`);
                pads.push(`[v${k}]`);
            }
            if (probe.hasAudio) {
                lines.push(`[${input}:a]atrim=${range},asetpts=PTS-STARTPTS[a${k}]`);
                pads.push(`[a${k}]`);
            }
        });
        const outs = `${withVideo ? '[vc]' : ''}${probe.hasAudio ? '[ac]' : ''}`;
        lines.push(`${pads.join('')}concat=n=${segments.length}:v=${withVideo ? 1 : 0}:a=${probe.hasAudio ? 1 : 0}${outs}`);
        // ponytail: the graph rides on the command line at ~100 characters a
        // segment, so Windows' 32k limit caps an edit near 300 segments; pass it
        // as a file (-/filter_complex) once every ffmpeg in use is 7 or newer
        return lines;
    };
    return { inputs, chains };
}

interface Loudness {
    input_i: string;
    input_tp: string;
    input_lra: string;
    input_thresh: string;
    target_offset: string;
}

// Pass one of two: measure the edited audio, so pass two can apply one linear gain
async function measureLoudness(inputs: string[], audioChains: string[], target: string): Promise<Loudness> {
    const { stderr } = await execFileAsync(FFMPEG, [
        '-hide_banner', '-nostdin', '-nostats',
        ...inputs,
        '-filter_complex', [...audioChains, `[ac]loudnorm=${target}:print_format=json[measured]`].join(';'),
        '-map', '[measured]', '-f', 'null', '-'
    ], { maxBuffer: MAX_BUFFER, windowsHide: true });
    const loudness = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as Loudness;
    if (!Number.isFinite(Number(loudness.input_i))) throw new Error('loudnorm: the edited audio is silent, so there is nothing to normalise');
    return loudness;
}

// ---- hook text and captions: an .ass file burned in by libass ---------------

const assTime = (t: number): string => {
    const cs = Math.max(0, Math.round(t * 100));
    const two = (n: number) => String(n).padStart(2, '0');
    return `${Math.floor(cs / 360000)}:${two(Math.floor(cs / 6000) % 60)}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}`;
};

// Braces open override tags and backslashes escape in ASS, so neither may
// reach it. Noto Sans has no Arabic glyphs: Arabic runs switch font
// explicitly instead of trusting libass's fallback.
const assText = (text: string): string => text
    .replace(/[{}\\]/g, '')
    .replace(/\p{scx=Arab}+(?:\s+\p{scx=Arab}+)*/gu, run => `{\\fn${ARABIC_FONT}}${run}{\\fn${LATIN_FONT}}`)
    .replace(/\r?\n/g, '\\N');

interface Line {
    start: number;
    end: number;
    text: string;
}

// A few words at a time, broken at sentence ends, pauses and where the tease ends
function captionLines(words: OutputWord[], style: 'bold' | 'clean'): Line[] {
    const [maxWords, maxChars] = style === 'bold' ? [3, 18] : [7, 36];
    const lines: Line[] = [];
    let current: OutputWord[] = [];
    const flush = () => {
        if (current.length) lines.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map(word => word.text).join(' ') });
        current = [];
    };
    for (const word of words) {
        const last = current[current.length - 1];
        const length = [...[...current, word].map(w => w.text).join(' ')].length;
        if (last && (current.length === maxWords || length > maxChars || /[.!?؟]$/.test(last.text)
            || word.start - last.end > 0.6 || word.tease !== last.tease)) flush();
        current.push(word);
    }
    flush();
    // Hold a line until the next one when the gap is short, so captions don't flicker
    lines.forEach((line, i) => {
        const next = lines[i + 1];
        if (next && next.start - line.end < 0.3) line.end = next.start;
    });
    return lines;
}

function writeSubtitles(
    plan: EditPlan,
    segments: Segment[],
    words: Word[],
    { width, height }: { width: number; height: number },
    dir: string
): string | undefined {
    const [hook] = opsOf(plan, 'hookText');
    const [captions] = opsOf(plan, 'captions');
    if (!hook && !captions) return undefined;

    const px = (share: number) => Math.round(height * share);
    const side = Math.round(width * 0.08);
    // Above Instagram's caption and buttons; the top margin clears its top bar
    const low = px(0.3);
    // Encoding -1 asks libass to find each line's base direction (right-to-left for Arabic)
    const style = (name: string, fontSize: number, outline: string, back: string, bold: boolean, border: number, borderSize: number, align: number, marginV: number) =>
        `Style: ${name},${LATIN_FONT},${fontSize},&H00FFFFFF,&H00FFFFFF,${outline},${back},${bold ? -1 : 0},0,0,0,100,100,0,0,${border},${borderSize},0,${align},${side},${side},${marginV},-1`;

    const events: string[] = [];
    if (hook) {
        const align = { top: 8, center: 5, bottom: 2 }[hook.position];
        const marginV = hook.position === 'bottom' ? low : 0;   // 0: the style's top margin
        events.push(`Dialogue: 0,${assTime(hook.start)},${assTime(hook.end)},hook,,0,0,${marginV},,{\\an${align}}${assText(hook.text[plan.language])}`);
    }
    if (captions) {
        for (const line of captionLines(outputWords(segments, words), captions.style)) {
            events.push(`Dialogue: 0,${assTime(line.start)},${assTime(line.end)},${captions.style},,0,0,0,,${assText(line.text)}`);
        }
    }

    const file = path.join(dir, 'edit.ass');
    writeFileSync(file, [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${width}`,
        `PlayResY: ${height}`,
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        style('hook', px(0.058), '&H00000000', '&H00000000', true, 1, px(0.005), 8, px(0.14)),
        style('bold', px(0.052), '&H00000000', '&H00000000', true, 1, px(0.005), 2, low),
        // BorderStyle 4 (libass): one box behind each whole line; the glyph outline stays transparent
        style('clean', px(0.036), '&HFF000000', '&H80000000', false, 4, px(0.007), 2, low),
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...events,
        ''
    ].join('\n'), 'utf8');
    return file;
}
