'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { LOUDNESS_TARGET_LUFS } from '@/lib/constants';
import { pickText, useLang } from '@/lib/i18n';
import type {
    ActualPerformance,
    AnalysisResult,
    HookAnalysis,
    LocalizedText,
    PerformanceReview,
    TechnicalSignals
} from '@/types/analysis';
import ViralityMeter from './ViralityMeter';
import MetricsGrid from './MetricsGrid';
import RecommendationsPanel from './RecommendationsPanel';
import PredictionCard from './PredictionCard';
import EditPanel from './EditPanel';

interface AnalysisResultsProps {
    result: AnalysisResult;
    onAnalyzeAnother: () => void;
    onDownloadReport: () => void;
    /** The analysed video; enables the Edit tab. */
    fileId?: string;
    /** Analyse an edited export as a new upload. */
    onReanalyze?: (fileId: string) => void;
    /** This result is a re-analysis of an edited export. */
    isEditEstimate?: boolean;
}

export default function AnalysisResults({
    result,
    onAnalyzeAnother,
    onDownloadReport,
    fileId,
    onReanalyze,
    isEditEstimate
}: AnalysisResultsProps) {
    const { t, lang } = useLang();
    const [tab, setTab] = useState<'report' | 'edit'>('report');
    const tabClass = (active: boolean) =>
        `py-2 px-5 rounded-xl text-sm font-semibold transition-colors ${active
            ? 'bg-gradient-to-r from-pink-500 to-orange-500 text-white'
            : 'text-gray-400 hover:text-white hover:bg-gray-800'}`;
    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-fade-in pb-12">
            <ProviderBadge provider={result.provider} note={result.providerNote} />

            {isEditEstimate && (
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
                    {t('editEstimateBanner')}
                </div>
            )}

            {fileId && onReanalyze && (
                <div role="tablist" className="inline-flex gap-1 p-1 rounded-2xl bg-gray-800/50 border border-gray-700/50">
                    <button role="tab" aria-selected={tab === 'report'} onClick={() => setTab('report')} className={tabClass(tab === 'report')}>
                        {t('tabReport')}
                    </button>
                    <button role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')} className={tabClass(tab === 'edit')}>
                        {t('tabEdit')}
                    </button>
                </div>
            )}

            {tab === 'edit' && fileId && onReanalyze ? (
                <EditPanel fileId={fileId} calibration={result.calibration} technical={result.technical} onReanalyze={onReanalyze} />
            ) : (
            <div className="space-y-8">

            {/* Reality Check: prediction vs the reel's real performance */}
            {result.performanceReview && result.actual && (
                <RealityCheckPanel
                    review={result.performanceReview}
                    actual={result.actual}
                    score={result.viralityScore}
                    predictedReach={result.estimatedReach}
                />
            )}

            {/* Top Section: Score & Stats */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                {/* Score Circle - Left (or Top) */}
                <div className="md:col-span-5 lg:col-span-4 flex flex-col items-center justify-center p-8 bg-gray-800/50 rounded-2xl border border-gray-700/50">
                    <ViralityMeter score={result.viralityScore} />

                    <div className="mt-8 text-center space-y-2">
                        <h3 className="text-white font-medium">{t('summaryTitle')}</h3>
                        <p className="text-sm text-gray-400 leading-relaxed max-w-xs mx-auto">
                            {pickText(result.summary, lang)}
                        </p>
                    </div>
                </div>

                {/* Stats & Key Metrics - Right */}
                <div className="md:col-span-7 lg:col-span-8 flex flex-col gap-6">
                    {/* Prediction — replaces three numbers the app could not defend */}
                    <PredictionCard calibration={result.calibration} technical={result.technical} score={result.viralityScore} />

                    {/* Detailed Metrics Grid */}
                    <div className="flex-1">
                        <MetricsGrid
                            metrics={result.metrics}
                            advice={result.metricAdvice}
                            technical={result.technical}
                            hook={result.hook}
                            provider={result.provider}
                        />
                    </div>
                </div>
            </div>

            {/* Hook Spotlight & Caption Idea */}
            {result.hook && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        <HookSpotlight hook={result.hook} />
                    </div>
                    <CaptionCard caption={result.suggestedCaption} hashtags={result.hashtags} />
                </div>
            )}

            {/* Bottom Section: Recommendations */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <RecommendationsPanel recommendations={result.recommendations} />
                </div>

                {/* Action Panel */}
                <div className="flex flex-col gap-4">
                    <div className="p-6 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 h-full">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Image src="/deal.png" alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
                            {t('nextSteps')}
                        </h3>

                        <button
                            onClick={onDownloadReport}
                            className="w-full mb-3 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-medium transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            {t('btnDownload')}
                        </button>

                        <button
                            onClick={onAnalyzeAnother}
                            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-pink-500/30 text-pink-400 hover:bg-pink-500/10 transition-colors font-medium"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t('btnAnother')}
                        </button>

                        <div className="mt-6 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                            <p className="text-xs text-purple-300">
                                <strong>{t('proTipTitle')}</strong> {t('proTipBody')}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Measured Technical Signals */}
            {result.technical && <TechnicalPanel technical={result.technical} />}

            {/* Full Transcript */}
            {result.transcript && <TranscriptPanel transcript={result.transcript} />}
            </div>
            )}
        </div>
    );
}

function ProviderBadge({ provider, note }: { provider: AnalysisResult['provider']; note?: string }) {
    const { t } = useLang();
    const isAI = provider !== 'heuristic';
    const label = provider === 'gemini'
        ? t('providerGemini')
        : provider === 'open'
            ? t('providerOpen')
            : t('providerHeuristic');
    return (
        <div
            className={`flex flex-col sm:flex-row sm:items-center gap-2 p-4 rounded-xl border ${
                isAI
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
            }`}
        >
            <span className="text-sm font-semibold whitespace-nowrap">{label}</span>
            {note && <span className="text-xs opacity-80">{note}</span>}
        </div>
    );
}

function HookSpotlight({ hook }: { hook: HookAnalysis }) {
    const { t, lang } = useLang();
    return (
        <div className="p-6 bg-gray-800/50 rounded-2xl border border-gray-700/50 h-full">
            <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                <Image src="/bait.png" alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
                {t('hookTitle')}
            </h3>
            <p className="text-xs text-gray-500 mb-4">{t('hookSub')}</p>

            {hook.thumbnails.length > 0 && (
                <div className="flex gap-3 mb-4 overflow-x-auto">
                    {hook.thumbnails.map((src, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            key={index}
                            src={src}
                            alt={`Hook frame ${index + 1}`}
                            className="h-28 rounded-lg border border-gray-700 object-cover"
                        />
                    ))}
                </div>
            )}

            {hook.transcript && (
                <p className="text-sm text-gray-300 mb-2 italic">“{hook.transcript}”</p>
            )}
            {hook.verdict && <p className="text-sm text-gray-400 mb-2">{pickText(hook.verdict, lang)}</p>}
            <p className="text-xs text-gray-500">
                {hook.cutsInFirstThreeSeconds} {t('hookCutsSuffix')}
            </p>
        </div>
    );
}

function CaptionCard({ caption, hashtags }: { caption?: LocalizedText; hashtags?: string[] }) {
    const { t, lang } = useLang();
    const [copied, setCopied] = useState(false);
    const captionText = pickText(caption, lang);
    const hasContent = Boolean(captionText || (hashtags && hashtags.length > 0));

    if (!hasContent) {
        return (
            <div className="p-6 bg-gray-800/50 rounded-2xl border border-dashed border-gray-700 flex flex-col items-center justify-center text-center">
                <Image src="/graphic-designer.png" alt="" width={32} height={32} className="w-8 h-8 object-contain mb-2" />
                <p className="text-sm text-gray-400">
                    {t('captionEmpty')}
                </p>
            </div>
        );
    }

    const fullText = [captionText, hashtags?.join(' ')].filter(Boolean).join('\n\n');
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(fullText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // clipboard unavailable — ignore
        }
    };

    return (
        <div className="p-6 bg-gray-800/50 rounded-2xl border border-gray-700/50 flex flex-col">
            <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                <Image src="/graphic-designer.png" alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
                {t('captionTitle')}
            </h3>
            {captionText && <p className="text-sm text-gray-300 mb-3 whitespace-pre-wrap">{captionText}</p>}
            {hashtags && hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-4">
                    {hashtags.map(tag => (
                        <span
                            key={tag}
                            className="px-2 py-0.5 text-xs rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
            <button
                onClick={handleCopy}
                className="mt-auto w-full py-2 px-4 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
                {copied ? t('btnCopied') : t('btnCopy')}
            </button>
        </div>
    );
}

function TechnicalPanel({ technical }: { technical: TechnicalSignals }) {
    const { t } = useLang();
    const checks: { label: string; value: string; ok: boolean; hint: string }[] = [
        {
            label: t('techResolution'),
            value: `${technical.width}×${technical.height}`,
            ok: technical.height >= 1920 && technical.width >= 1080,
            hint: t('hintResolution')
        },
        {
            label: t('techAspect'),
            value: technical.aspectRatio,
            ok: technical.isVertical,
            hint: t('hintAspect')
        },
        {
            label: t('techFps'),
            value: technical.fps > 0 ? `${technical.fps} fps` : t('techUnknown'),
            ok: technical.fps >= 30,
            hint: t('hintFps')
        },
        {
            label: t('techLoudness'),
            value: technical.loudnessLufs === null ? t('techNoAudio') : `${technical.loudnessLufs} LUFS`,
            ok: technical.loudnessLufs !== null && Math.abs(technical.loudnessLufs - LOUDNESS_TARGET_LUFS) <= 2,
            hint: t('hintLoudness')
        },
        {
            label: t('techPacing'),
            value: `${technical.cutsPerMinute}/min`,
            ok: technical.cutsPerMinute >= 15 && technical.cutsPerMinute <= 40,
            hint: t('hintPacing')
        },
        {
            label: t('techDuration'),
            value: `${technical.duration}s`,
            ok: technical.durationFit === 'optimal',
            hint: t('hintDuration')
        }
    ];

    return (
        <div className="p-6 bg-gray-800/50 rounded-2xl border border-gray-700/50">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Image src="/arrow.png" alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
                {t('technicalTitle')}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {checks.map(check => (
                    <div key={check.label} className="p-3 rounded-xl bg-gray-800/80 border border-gray-700/50">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-400 uppercase tracking-wider">{check.label}</span>
                            <span className={`text-xs font-bold ${check.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {check.ok ? '✓' : '△'}
                            </span>
                        </div>
                        <p className="text-sm font-semibold text-white">{check.value}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{check.hint}</p>
                    </div>
                ))}
            </div>
            <p className="text-xs text-gray-500 mt-4">
                {technical.cutCount} {t('wordCuts')} · {t('wordAvgShot')} {technical.avgShotSeconds}s ·{' '}
                {technical.silences.length} {t('wordSilences')} · {technical.bitrateKbps} kbps
            </p>
        </div>
    );
}

function RealityCheckPanel({ review, actual, score, predictedReach }: { review: PerformanceReview; actual: ActualPerformance; score: number; predictedReach: string }) {
    const { t, lang } = useLang();
    const verdictLabel = review.verdict === 'overperformed' ? t('rcVerdictOver')
        : review.verdict === 'underperformed' ? t('rcVerdictUnder') : t('rcVerdictExpected');
    const verdictClass = review.verdict === 'overperformed'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        : review.verdict === 'underperformed'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-gray-700/40 border-gray-600 text-gray-300';
    const interactions = actual.likes + actual.comments + actual.saved + actual.shares;

    return (
        <div className="p-6 bg-gray-800/50 rounded-2xl border border-gray-700/50">
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Image src="/arrow.png" alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
                    {t('rcTitle')}
                </h3>
                <span className={`px-3 py-1 rounded-full border text-xs font-semibold ${verdictClass}`}>{verdictLabel}</span>
            </div>

            {/* The core comparison: what the app predicted vs what actually happened */}
            <div className="flex flex-wrap gap-2 mb-3 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300">
                    {t('rcPredicted')}: {predictedReach}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-pink-500/10 border border-pink-500/30 text-pink-300">
                    {t('rcActual')}: {actual.reach.toLocaleString()} {t('rcReach')}
                </span>
            </div>

            <div className="flex flex-wrap gap-2 mb-5 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
                    {actual.views.toLocaleString()} {t('igViews')} · {interactions.toLocaleString()} {t('rcInteractions')}
                </span>
                <span className="px-2.5 py-1 rounded-full bg-gray-800 border border-gray-700 text-gray-300">
                    {t('rcAppScore')}: {score}/100
                </span>
            </div>

            <h4 className="text-sm font-semibold text-gray-300 mb-2">{t('rcWhy')}</h4>
            <ul className="space-y-2 mb-5">
                {review.whyItHappened.map(reason => (
                    <li key={reason.en} className="flex gap-2 text-sm text-gray-200 leading-relaxed">
                        <span className="text-pink-400 mt-0.5">▸</span>
                        <span>{pickText(reason, lang)}</span>
                    </li>
                ))}
            </ul>

            <h4 className="text-sm font-semibold text-gray-300 mb-2">{t('rcNext')}</h4>
            <ul className="space-y-2">
                {review.whatToDoNext.map(action => (
                    <li key={action.en} className="flex gap-2 text-sm text-gray-200 leading-relaxed">
                        <span className="text-emerald-400 mt-0.5">▸</span>
                        <span>{pickText(action, lang)}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function TranscriptPanel({ transcript }: { transcript: string }) {
    const { t } = useLang();
    return (
        <details className="p-6 bg-gray-800/50 rounded-2xl border border-gray-700/50 group">
            <summary className="text-lg font-bold text-white cursor-pointer select-none list-none flex items-center justify-between">
                <span className="flex items-center gap-2">
                    <Image src="/spech.png" alt="" width={26} height={26} className="w-[26px] h-[26px] object-contain" />
                    {t('transcriptTitle')}
                </span>
                <span className="text-xs text-gray-500 font-normal group-open:hidden">{t('expandHint')}</span>
            </summary>
            <p className="mt-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{transcript}</p>
        </details>
    );
}
