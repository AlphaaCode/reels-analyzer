'use client';

// The Edit tab. The user's own Claude Code (Opus 5.5) plans the edit from the
// report and the forecast state; the app checks the plan, renders the ops the
// user keeps and shows only what it measured on both files. Nothing here says
// or implies the edit will raise reach or the score.

import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useLang, pickText, type StringKey } from '@/lib/i18n';
import { forecastFor, type ForecastState } from '@/lib/calibration';
import type { Gate } from '@/lib/agent/claude';
import type { EditJob, ExportEntry } from '@/lib/edit/job';
import type { EditOp } from '@/lib/edit/plan';
import type { MeasuredSignals } from '@/lib/edit/render';
import type { CalibrationSummary, TechnicalSignals } from '@/types/analysis';
import { formatCount } from './ReachStrip';
import { SIGNAL_LABELS } from './PredictionCard';

interface EditPanelProps {
    fileId: string;
    calibration?: CalibrationSummary;
    technical?: TechnicalSignals;
    onReanalyze: (fileId: string) => void;
}

const STATE_KEYS: Record<ForecastState, StringKey> = {
    locked: 'editStateLocked', low: 'editStateLow', mid: 'editStateMid', high: 'editStateHigh'
};
const STRATEGY_KEYS: Record<ForecastState, StringKey> = {
    locked: 'editStrategyLocked', low: 'editStrategyLow', mid: 'editStrategyMid', high: 'editStrategyHigh'
};
const STATE_TONES: Record<ForecastState, string> = {
    locked: 'text-gray-300', low: 'text-amber-300', mid: 'text-gray-100', high: 'text-emerald-300'
};
const OP_KEYS: Record<EditOp['kind'], StringKey> = {
    cut: 'opCut', trimSilence: 'opTrimSilence', rehook: 'opRehook', hookText: 'opHookText',
    loudnorm: 'opLoudnorm', captions: 'opCaptions', punchIn: 'opPunchIn'
};
const GATE_KEYS: Record<NonNullable<Gate['missing']>, StringKey> = {
    cli: 'editGateCli', auth: 'editGateAuth', model: 'editGateModel', call: 'editGateCall'
};
// Same rows as tools/render-edit.mjs prints
const DIFF_ROWS: [StringKey, (s: MeasuredSignals) => number | null][] = [
    ['diffDuration', s => s.duration],
    ['diffCuts', s => s.cutCount],
    ['diffCpm', s => s.cutsPerMinute],
    ['diffCuts3', s => s.cutsInFirstThreeSeconds],
    ['diffLufs', s => s.loudnessLufs],
    ['diffSilences', s => s.silences.length]
];
const BUSY: EditJob['status'][] = ['preparing', 'planning', 'rendering'];

const sec = (t: number) => `${Math.round(t * 100) / 100} s`;
const round = (n: number | null) => (n === null ? '-' : String(Math.round(n * 10) / 10));

export default function EditPanel({ fileId, calibration, technical, onReanalyze }: EditPanelProps) {
    const { t, lang } = useLang();
    const [gate, setGate] = useState<Gate | null>(null);
    const [preview, setPreview] = useState<{ sourceUrl: string; command: string } | null>(null);
    const [job, setJob] = useState<EditJob | null>(null);
    const [enabled, setEnabled] = useState<boolean[]>([]);
    const [exports, setExports] = useState<ExportEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Same call as the prediction card, so the two can never disagree
    const forecast = forecastFor({ signalKey: calibration?.strongestSignal?.key, signalBands: calibration?.signalBands }, technical);
    const state = job?.forecast?.state ?? forecast.state;
    const signalName = forecast.signalKey ? (SIGNAL_LABELS[forecast.signalKey]?.[lang] ?? forecast.signalKey) : '';

    const loadGate = useCallback((fresh = false) => {
        axios.get<Gate>('/api/edit/gate', { params: fresh ? { fresh: 1 } : {} })
            .then(response => setGate(response.data))
            .catch(() => setGate({ ok: false, missing: 'call', model: 'claude-opus-5-5', checkedAt: Date.now() }));
    }, []);
    const loadExports = useCallback(() => {
        axios.get<{ exports: ExportEntry[] }>('/api/edit/exports').then(response => setExports(response.data.exports)).catch(() => {});
    }, []);

    useEffect(() => {
        loadGate();
        loadExports();
        axios.get('/api/edit/start', { params: { fileId } }).then(response => setPreview(response.data)).catch(() => {});
    }, [fileId, loadGate, loadExports]);

    // Poll while the job is busy
    useEffect(() => {
        if (!job || !BUSY.includes(job.status)) return;
        const timer = setTimeout(async () => {
            try {
                const response = await axios.get<{ job: EditJob }>('/api/edit/status', { params: { job: job.id } });
                const next = response.data.job;
                if (job.status === 'planning' && next.status === 'planned' && next.plan) {
                    // Ops the checker refused start unticked
                    const broken = new Set((next.validation?.errors ?? []).map(e => /^\/ops\/(\d+)/.exec(e.path)?.[1]).filter(Boolean).map(Number));
                    setEnabled(next.plan.ops.map((_, i) => !broken.has(i)));
                }
                if (job.status === 'rendering' && next.status === 'done') loadExports();
                setJob(next);
            } catch {
                setError('Lost the edit job. Start again.');
                setJob(null);
            }
        }, 2000);
        return () => clearTimeout(timer);
    }, [job, loadExports]);

    const startPlan = async () => {
        setError(null);
        try {
            const response = await axios.post<{ jobId: string }>('/api/edit/start', { fileId });
            setJob({ id: response.data.jobId, fileId, status: 'preparing', lines: [], sourceUrl: preview?.sourceUrl ?? '', command: preview?.command ?? '', createdAt: Date.now() });
        } catch (err) {
            setError(axios.isAxiosError(err) ? String(err.response?.data?.error ?? err.message) : 'Failed to start');
        }
    };

    const render = async () => {
        if (!job) return;
        setError(null);
        try {
            await axios.post('/api/edit/render', { job: job.id, enabledOps: enabled.flatMap((on, i) => (on ? [i] : [])) });
            setJob({ ...job, status: 'rendering', error: undefined });
        } catch (err) {
            setError(axios.isAxiosError(err) ? String(err.response?.data?.error ?? err.message) : 'Failed to render');
        }
    };

    const reanalyze = async (id: string) => {
        const response = await axios.post<{ fileId: string }>(`/api/edit/exports/${id}`);
        onReanalyze(response.data.fileId);
    };

    const remove = async (id: string) => {
        await axios.delete(`/api/edit/exports/${id}`).catch(() => {});
        if (job?.exportId === id) setJob({ ...job, status: 'planned', exportId: undefined, before: undefined, after: undefined });
        loadExports();
    };

    const copy = async () => {
        if (!preview) return;
        await navigator.clipboard.writeText(preview.command);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const opDetail = (op: EditOp): string => {
        switch (op.kind) {
            case 'cut': return `${sec(op.start)} - ${sec(op.end)}`;
            case 'trimSilence': return t('opTrimDetail').replace('{min}', String(op.minGapSec)).replace('{keep}', String(op.keepSec));
            case 'rehook': return `${sec(op.fromSec)} - ${sec(op.toSec)}, ${t(op.mode === 'tease' ? 'opTease' : 'opMove')}`;
            case 'hookText': return `"${pickText(op.text, lang)}" ${sec(op.start)} - ${sec(op.end)} ${t('opEditedTime')}`;
            case 'loudnorm': return `${op.targetLufs} LUFS`;
            case 'captions': return op.style;
            case 'punchIn': return `${sec(op.at)}, ${sec(op.durationSec)}, x${op.scale}`;
        }
    };

    const busy = job !== null && BUSY.includes(job.status);
    const card = 'p-5 rounded-2xl bg-gray-800/50 border border-gray-700/50';

    return (
        <div className="space-y-6">
            {/* Gate and who pays */}
            <div className={card}>
                <h3 className="text-lg font-bold text-white mb-2">{t('editTitle')}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{t('editUsage')}</p>
                {!gate && <p className="mt-3 text-sm text-gray-400">{t('editGateChecking')}</p>}
                {gate && !gate.ok && gate.missing && (
                    <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                        <p className="text-sm font-semibold text-amber-300">{t('editGateLocked')}</p>
                        <p className="text-sm text-gray-200 mt-1">{t(GATE_KEYS[gate.missing])}</p>
                        {gate.detail && <p className="text-xs text-gray-500 mt-1 break-words" dir="ltr">{gate.detail}</p>}
                        <button onClick={() => { setGate(null); loadGate(true); }} className="mt-2 text-sm text-pink-400 hover:text-pink-300">{t('editGateRecheck')}</button>
                    </div>
                )}
            </div>

            {/* Forecast state and why */}
            <div className={card}>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{t('editForecastTitle')}</h4>
                <p className={`text-2xl font-bold mt-1 ${STATE_TONES[state]}`}>{t(STATE_KEYS[state])}</p>
                {forecast.band && forecast.value !== undefined ? (
                    <>
                        <p className="text-sm text-gray-200 mt-1">
                            {t('editWhyBand')
                                .replace('{value}', String(Math.round(forecast.value * 10) / 10))
                                .replace('{signal}', signalName)
                                .replace('{min}', String(forecast.band.min))
                                .replace('{max}', String(forecast.band.max))
                                .replace('{median}', formatCount(forecast.band.q50))
                                .replace('{count}', String(forecast.band.count))}
                        </p>
                        {forecast.best && forecast.best !== forecast.band && (
                            <p className="text-xs text-gray-400 mt-1">
                                {t('editWhyBest')
                                    .replace('{min}', String(forecast.best.min))
                                    .replace('{signal}', signalName)
                                    .replace('{median}', formatCount(forecast.best.q50))
                                    .replace('{count}', String(forecast.best.count))}
                            </p>
                        )}
                    </>
                ) : (
                    <p className="text-sm text-gray-300 mt-1">{t('editWhyLocked')}</p>
                )}
                <p className="text-sm text-gray-400 mt-3">{t(STRATEGY_KEYS[state])}</p>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                        onClick={startPlan}
                        disabled={!gate?.ok || busy}
                        className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {t(job ? 'editRunAgain' : 'editRun')}
                    </button>
                </div>
                {preview && (
                    <div className="mt-4">
                        <p className="text-xs text-gray-500 mb-1">{t('editCommandLabel')}</p>
                        <div className="flex items-center gap-2">
                            <code dir="ltr" className="flex-1 text-xs text-gray-200 bg-gray-900/70 border border-gray-700 rounded-lg px-3 py-2 overflow-x-auto whitespace-nowrap">{preview.command}</code>
                            <button onClick={copy} className="text-xs py-2 px-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white">{t(copied ? 'editCopied' : 'editCopy')}</button>
                        </div>
                    </div>
                )}
                {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            </div>

            {/* Live agent status */}
            {job && (job.status === 'preparing' || job.status === 'planning' || job.lines.length > 0) && (
                <div className={card}>
                    {(job.status === 'preparing' || job.status === 'planning') && (
                        <p className="text-sm text-gray-300">{t(job.status === 'preparing' ? 'editPreparing' : 'editPlanning')}</p>
                    )}
                    {job.lines.length > 0 && (
                        <ol dir="ltr" className="mt-2 max-h-48 overflow-y-auto text-xs text-gray-400 font-mono space-y-0.5">
                            {job.lines.map((line, i) => <li key={i} className="break-words">{line}</li>)}
                        </ol>
                    )}
                </div>
            )}
            {job?.status === 'error' && <p className="text-sm text-red-400">{job.error}</p>}

            {/* The plan */}
            {job?.plan && (
                <div className={card}>
                    <h4 className="text-lg font-bold text-white">{t('editPlanTitle')}</h4>
                    <p className="text-xs text-gray-500 mt-1">{t('editPlanHint')}</p>
                    <p className={`text-sm mt-2 ${job.validation?.errors.length ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {job.validation?.errors.length
                            ? t('editCheckErrors').replace('{n}', String(job.validation.errors.length))
                            : t('editCheckOk')}
                    </p>
                    <ul className="mt-3 space-y-2">
                        {job.plan.ops.map((op, i) => (
                            <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-gray-900/50 border border-gray-700/50">
                                <input
                                    type="checkbox"
                                    className="mt-1 accent-pink-500"
                                    checked={enabled[i] ?? true}
                                    disabled={busy}
                                    onChange={event => setEnabled(enabled.map((on, j) => (j === i ? event.target.checked : on)))}
                                    aria-label={t(OP_KEYS[op.kind])}
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white">
                                        <span className="font-semibold">{t(OP_KEYS[op.kind])}</span>{' '}
                                        <span className="text-gray-400" dir="auto">{opDetail(op)}</span>
                                    </p>
                                    <p className="text-sm text-gray-300 mt-0.5" dir="auto">{pickText(op.reason, lang)}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{t('opFinding')} <code dir="ltr">{op.finding}</code></p>
                                    {job.validation?.errors.filter(e => e.path === `/ops/${i}` || e.path.startsWith(`/ops/${i}/`)).map((e, k) => (
                                        <p key={k} className="text-xs text-amber-300 mt-0.5" dir="ltr">{e.path}: {e.message}</p>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                    <button
                        onClick={render}
                        disabled={busy || !enabled.some(Boolean)}
                        className="mt-4 py-2.5 px-5 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {job.status === 'rendering' ? t('editRendering') : t('editRender')}
                    </button>
                </div>
            )}

            {/* Before / after, measured */}
            {job?.status === 'done' && job.exportId && job.before && job.after && (
                <div className={card}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {[['editBefore', job.sourceUrl], ['editAfter', `/api/edit/exports/${job.exportId}`]].map(([label, src]) => (
                            <div key={label}>
                                <p className="text-sm font-semibold text-gray-300 mb-2">{t(label as StringKey)}</p>
                                <video src={src} controls playsInline className="w-full max-h-[480px] rounded-xl bg-black" />
                            </div>
                        ))}
                    </div>
                    <DiffTable before={job.before} after={job.after} />
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button onClick={() => reanalyze(job.exportId!)} className="py-2.5 px-5 rounded-xl border border-pink-500/30 text-pink-400 hover:bg-pink-500/10 font-medium">
                            {t('editReanalyze')}
                        </button>
                        <a href={`/api/edit/exports/${job.exportId}`} download={`${job.exportId}.mp4`} className="text-sm text-gray-300 hover:text-white">{t('editDownload')}</a>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">{t('editReanalyzeNote')}</p>
                </div>
            )}

            {/* Exports */}
            <div className={card}>
                <h4 className="text-lg font-bold text-white mb-3">{t('editExportsTitle')}</h4>
                {exports.length === 0 ? (
                    <p className="text-sm text-gray-500">{t('editExportsEmpty')}</p>
                ) : (
                    <ul className="space-y-2">
                        {exports.map(entry => (
                            <li key={entry.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-gray-900/50 border border-gray-700/50">
                                <span dir="ltr" className="text-xs text-gray-400 font-mono">{entry.id.slice(0, 12)}...{entry.id.slice(-3)}</span>
                                <span dir="ltr" className="text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString(lang === 'ar' ? 'ar' : 'en')}</span>
                                <span className="text-xs text-gray-400">
                                    {t('diffDuration')}: <span dir="ltr">{round(entry.before.duration)} → {round(entry.after.duration)}</span>
                                </span>
                                <div className="ms-auto flex items-center gap-3">
                                    <a href={`/api/edit/exports/${entry.id}`} download={`${entry.id}.mp4`} className="text-sm text-gray-300 hover:text-white">{t('editDownload')}</a>
                                    <button onClick={() => reanalyze(entry.id)} className="text-sm text-pink-400 hover:text-pink-300">{t('editReanalyze')}</button>
                                    <button onClick={() => remove(entry.id)} className="text-sm text-red-400 hover:text-red-300">{t('editDelete')}</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}

function DiffTable({ before, after }: { before: MeasuredSignals; after: MeasuredSignals }) {
    const { t } = useLang();
    return (
        <div className="mt-5">
            <h4 className="text-sm font-bold text-white">{t('editDiffTitle')}</h4>
            <p className="text-xs text-gray-500 mt-0.5">{t('editDiffNote')}</p>
            <table className="mt-2 w-full text-sm">
                <thead>
                    <tr className="text-gray-400 text-xs">
                        <th className="text-start font-medium py-1">{t('editDiffMeasure')}</th>
                        <th className="text-end font-medium py-1">{t('editBefore')}</th>
                        <th className="text-end font-medium py-1">{t('editAfter')}</th>
                        <th className="text-end font-medium py-1">{t('editDiffChange')}</th>
                    </tr>
                </thead>
                <tbody>
                    {DIFF_ROWS.map(([key, read]) => {
                        const a = read(before);
                        const b = read(after);
                        const change = a === null || b === null ? null : Math.round((b - a) * 10) / 10;
                        return (
                            <tr key={key} className="border-t border-gray-700/50 text-gray-200">
                                <td className="py-1.5">{t(key)}</td>
                                <td className="py-1.5 text-end"><span dir="ltr">{round(a)}</span></td>
                                <td className="py-1.5 text-end"><span dir="ltr">{round(b)}</span></td>
                                <td className="py-1.5 text-end text-gray-400"><span dir="ltr">{change === null ? '-' : change > 0 ? `+${change}` : String(change)}</span></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
