// Edit jobs for the app's Edit tab: prepare a job folder, let the user's own
// Claude Code plan in it, check the plan, then render the ops the user kept.
// Same in-memory store pattern as analyzeJob.ts; the folders stay on disk in
// data/edit-jobs/{id} so a run can be inspected afterwards.

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { runClaude } from '@/lib/agent/claude';
import { AnalysisError, findVideo } from '@/lib/analyzeJob';
import { getCalibration } from '@/lib/calibrationStore';
import type { Validation } from '@/lib/validate';
import type { EditPlan } from './plan';
import { prepareEditJob, type ForecastFile } from './prepare';
import { EXPORT_ID_PATTERN, exportFile, renderEdit, type MeasuredSignals } from './render';
import { loadEditContext, validateEditPlan, type EditContext } from './validate';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES = 80;
const JOB_TTL_MS = 60 * 60 * 1000;

export const editJobsDir = (): string => path.join(process.cwd(), 'data', 'edit-jobs');
export const exportsDir = (): string => path.join(process.cwd(), 'exports');

export interface EditJob {
    id: string;
    fileId: string;
    status: 'preparing' | 'planning' | 'planned' | 'rendering' | 'done' | 'error';
    lines: string[];
    sourceUrl: string;
    /** What the user can type into Claude Code in this repo to do the same by hand. */
    command: string;
    forecast?: ForecastFile;
    plan?: EditPlan;
    validation?: Validation;
    exportId?: string;
    before?: MeasuredSignals;
    after?: MeasuredSignals;
    error?: string;
    createdAt: number;
}

interface JobState {
    job: EditJob;
    jobDir: string;
    context?: EditContext;
}

const globalStore = globalThis as unknown as { __editJobs?: Map<string, JobState> };
const jobs: Map<string, JobState> = globalStore.__editJobs ?? (globalStore.__editJobs = new Map());

function sweepJobs(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, state] of jobs) {
        if (state.job.createdAt < cutoff && state.job.status !== 'planning' && state.job.status !== 'rendering') jobs.delete(id);
    }
}

export function getEditJob(id: string): EditJob | undefined {
    sweepJobs();
    return UUID_PATTERN.test(id) ? jobs.get(id)?.job : undefined;
}

/** What to type into Claude Code in this repo to make the same edit by hand. */
export const editReelCommand = (videoPath: string): string =>
    `/edit-reel ${path.relative(process.cwd(), videoPath).split(path.sep).join('/')}`;

/** The prompt passes the state and the numbers behind it; the reel-edit skill holds the rules. */
function planningPrompt(sha256: string, forecast: ForecastFile): string {
    const basis = forecast.state === 'locked'
        ? 'No measured signal has survived calibration for this reel, so the state is locked.'
        : `${forecast.signalKey} is ${forecast.value} for this reel, which falls in the band ${forecast.band?.min} to ${forecast.band?.max}` +
          ` (median reach ${forecast.band?.q50} across ${forecast.band?.count} reels). The best band starts at ${forecast.best?.min}` +
          ` (median reach ${forecast.best?.q50} across ${forecast.best?.count} reels).`;
    return [
        'Plan an edit of one reel. Everything you need is in this folder; do not look outside it.',
        'Use the Read tool to read files. Bash runs only `node tools/check-edit.mjs ...`; anything else is refused.',
        'Load the reel-edit skill (.claude/skills/reel-edit/SKILL.md) first and follow it exactly.',
        `Forecast state: ${forecast.state}. ${basis}`,
        `The video's sha256 is ${sha256}.`,
        'Read forecast.json, report.json, signals.json and words.json, then write edit-plan.json.',
        'Run `node tools/check-edit.mjs edit-plan.json` and fix every ERROR, with at most 2 repair rounds. Do not render.',
        'End with one line: whether the check passed.'
    ].join('\n');
}

export async function startEditJob(fileId: unknown): Promise<string> {
    const video = await findVideo(fileId);
    sweepJobs();
    const id = uuidv4();
    const jobDir = path.join(editJobsDir(), id);
    const job: EditJob = {
        id,
        fileId: fileId as string,
        status: 'preparing',
        lines: [],
        sourceUrl: video.publicUrl,
        command: editReelCommand(video.path),
        createdAt: Date.now()
    };
    const state: JobState = { job, jobDir };
    jobs.set(id, state);
    const fail = (message: string) => Object.assign(job, { status: 'error', error: message, createdAt: Date.now() });
    const push = (line: string) => { job.lines = [...job.lines, line].slice(-MAX_LINES); };

    (async () => {
        const prepared = await prepareEditJob(video.path, jobDir, { calibration: getCalibration() });
        job.forecast = prepared.forecast;
        if (!prepared.hasReport) {
            throw new AnalysisError('This reel has no saved report yet. Analyze it again, then open Edit.', 409);
        }
        job.status = 'planning';
        const run = await runClaude({ cwd: jobDir, prompt: planningPrompt(prepared.sha256, prepared.forecast), onLine: push });
        const planFile = path.join(jobDir, 'edit-plan.json');
        if (!existsSync(planFile)) throw new Error(`No edit-plan.json was written: ${run.result}`);
        const plan = JSON.parse(readFileSync(planFile, 'utf8')) as EditPlan;
        state.context = { ...await loadEditContext(video.path), forecast: prepared.forecast.state };
        Object.assign(job, { status: 'planned', plan, validation: validateEditPlan(plan, state.context), createdAt: Date.now() });
    })().catch((error: unknown) => {
        console.error('Edit job failed:', error);
        fail(error instanceof Error ? error.message : 'The edit job failed');
    });
    return id;
}

/** Render the ops the user kept (indices into the planned ops). */
export function renderEditJob(id: unknown, enabledOps: unknown): void {
    const state = typeof id === 'string' && UUID_PATTERN.test(id) ? jobs.get(id) : undefined;
    if (!state?.job.plan || !state.context) throw new AnalysisError('Unknown edit job, or it has no plan yet', 404);
    if (state.job.status === 'rendering' || state.job.status === 'planning') throw new AnalysisError('The job is busy', 409);
    const plan = state.job.plan;
    if (!Array.isArray(enabledOps) || !enabledOps.every(i => Number.isInteger(i) && i >= 0 && i < plan.ops.length)) {
        throw new AnalysisError('enabledOps must list op indices', 400);
    }
    const ops = plan.ops.filter((_, i) => enabledOps.includes(i));
    if (ops.length === 0) throw new AnalysisError('Keep at least one op', 400);
    const kept = { ...plan, ops };
    const validation = validateEditPlan(kept, state.context);
    if (validation.errors.length) throw new AnalysisError(validation.errors.map(e => `${e.path}: ${e.message}`).join('; '), 422);

    const { job } = state;
    Object.assign(job, { status: 'rendering', error: undefined, exportId: undefined, before: undefined, after: undefined });
    renderEdit(kept, state.context)
        .then(output => Object.assign(job, {
            status: 'done',
            exportId: path.basename(output.video, '.mp4'),
            before: output.before,
            after: output.after,
            createdAt: Date.now()
        }))
        .catch((error: unknown) => {
            console.error('Edit render failed:', error);
            // Back to planned, so the user can change the ops and try again
            Object.assign(job, { status: 'planned', error: error instanceof Error ? error.message : 'Render failed' });
        });
}

export interface ExportEntry {
    id: string;
    createdAt: string;
    before: MeasuredSignals;
    after: MeasuredSignals;
}

/** A safe path inside exports/ for an export id, or undefined. */
export const exportPath = (id: unknown, suffix: '.mp4' | '.plan.json' | '.diff.json'): string | undefined =>
    exportFile(exportsDir(), id, suffix);

export function listExports(): ExportEntry[] {
    const dir = exportsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(name => name.endsWith('.diff.json') && EXPORT_ID_PATTERN.test(name.slice(0, -'.diff.json'.length)))
        .flatMap(name => {
            const id = name.slice(0, -'.diff.json'.length);
            try {
                const diff = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
                const video = exportPath(id, '.mp4');
                if (!video || !existsSync(video)) return [];
                return [{ id, createdAt: new Date(statSync(video).mtimeMs).toISOString(), before: diff.before, after: diff.after }];
            } catch {
                return [];
            }
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteExport(id: unknown): boolean {
    const files = (['.mp4', '.plan.json', '.diff.json'] as const).map(suffix => exportPath(id, suffix));
    if (files.some(file => !file)) return false;
    let removed = false;
    for (const file of files as string[]) {
        if (existsSync(file)) {
            rmSync(file);
            removed = true;
        }
    }
    return removed;
}
