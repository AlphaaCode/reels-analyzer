'use client';

// The verdict: a class, a number, and the one fix that would move it.
//
// Where the numbers come from matters. The AI score does not predict this
// account's reach (measured, rho -0.06), so the verdict is built on the signal
// that does survive testing — currently cuts per minute at rho 0.64 — using the
// account's own outcomes in that band. Every figure here is empirical.
//
// When nothing has survived testing yet, the card says so instead of guessing.

import React from 'react';
import Image from 'next/image';
import { useLang, type Lang } from '@/lib/i18n';
import { forecastFor } from '@/lib/calibration';
import type { CalibrationSummary, TechnicalSignals } from '@/types/analysis';
import ReachStrip, { formatCount } from './ReachStrip';

interface PredictionCardProps {
    calibration?: CalibrationSummary;
    technical?: TechnicalSignals;
    score: number;
}

export const SIGNAL_LABELS:Record<string, Record<Lang, string>> = {
    cutsPerMinute: { en: 'cuts per minute', ar: 'القطعات في الدقيقة' },
    avgShotSeconds: { en: 'average shot length', ar: 'متوسط طول اللقطة' },
    loudnessLufs: { en: 'loudness', ar: 'مستوى الصوت' },
    duration: { en: 'duration', ar: 'المدة' },
    cutsInFirstThreeSeconds: { en: 'cuts in the first 3 seconds', ar: 'القطعات في أول 3 ثوانٍ' }
};

export default function PredictionCard({ calibration, technical, score }: PredictionCardProps) {
    const { t, lang } = useLang();

    if (!calibration || calibration.reaches.length === 0) {
        return (
            <div className="p-5 rounded-2xl bg-gray-800/50 border border-dashed border-gray-700">
                <div className="flex items-center gap-2 mb-1">
                    <Image src="/statistics.png" alt="" width={22} height={22} className="w-[22px] h-[22px] object-contain" />
                    <h3 className="text-sm font-bold text-white">{t('predTitle')}</h3>
                </div>
                <p className="text-sm text-gray-400">{t('predNoHistory')}</p>
            </div>
        );
    }

    const { n, reaches, breakoutCount, breakoutThreshold, strongestSignal, signalBands } = calibration;
    const bands = signalBands ?? [];
    // Which band this reel falls into on the validated signal; the edit job uses the same call
    const { state, value, bandIndex, band, best } = forecastFor({ signalKey: strongestSignal?.key, signalBands }, technical);

    const verdictKey = state === 'low' ? 'predClassLow' : state === 'mid' ? 'predClassMid' : 'predClassHigh';
    const verdictTone = state === 'low' ? 'text-amber-300' : state === 'mid' ? 'text-gray-100' : 'text-emerald-300';
    const signalName = strongestSignal ? (SIGNAL_LABELS[strongestSignal.key]?.[lang] ?? strongestSignal.key) : '';

    return (
        <div className="p-5 rounded-2xl bg-gray-800/50 border border-gray-700/50">
            <div className="flex flex-wrap items-center gap-2 mb-3">
                <Image src="/statistics.png" alt="" width={22} height={22} className="w-[22px] h-[22px] object-contain" />
                <h3 className="text-sm font-bold text-white">{t('predTitle')}</h3>
                <span className="text-xs text-gray-500 ms-auto">{t('predScoredAt').replace('{score}', String(score))}</span>
            </div>

            {band ? (
                <>
                    <p className={`text-2xl font-bold ${verdictTone} leading-tight`}>{t(verdictKey as 'predClassLow')}</p>
                    <p className="text-sm text-gray-200 mt-1">
                        {t('predExpect')
                            .replace('{low}', formatCount(band.q25))
                            .replace('{high}', formatCount(band.q75))
                            .replace('{median}', formatCount(band.q50))}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                        {t('predBreakoutOdds')
                            .replace('{hits}', String(band.breakouts))
                            .replace('{count}', String(band.count))
                            .replace('{threshold}', formatCount(breakoutThreshold))}
                    </p>

                    <div className="mt-3">
                        <ReachStrip reaches={reaches} highlight={band.q50} highlightLabel={t('predExpectedHere')} />
                    </div>

                    {/* The lever, with the size of the prize */}
                    {best && bandIndex < bands.length - 1 && (
                        <div className="mt-3 p-3 rounded-xl bg-pink-500/5 border border-pink-500/20">
                            <h4 className="text-xs font-semibold text-pink-300 mb-1">{t('predFixTitle')}</h4>
                            <p className="text-sm text-gray-200 leading-relaxed">
                                {t('predFixBody')
                                    .replace('{signal}', signalName)
                                    .replace('{yours}', String(Number(value).toFixed(1)))
                                    .replace('{target}', String(best.min.toFixed(1)))
                                    .replace('{theirMedian}', formatCount(best.q50))
                                    .replace('{yourMedian}', formatCount(band.q50))
                                    .replace('{hits}', String(best.breakouts))
                                    .replace('{count}', String(best.count))}
                            </p>
                        </div>
                    )}
                    {best && bandIndex === bands.length - 1 && (
                        <p className="mt-3 text-sm text-emerald-300">
                            {t('predAlreadyBest').replace('{signal}', signalName).replace('{yours}', String(Number(value).toFixed(1)))}
                        </p>
                    )}

                    <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
                        {t('predBasis')
                            .replace('{signal}', signalName)
                            .replace('{rho}', strongestSignal!.rho.toFixed(2))
                            .replace('{n}', String(n))}
                    </p>
                </>
            ) : (
                <>
                    <p className="text-xs text-gray-500 mb-2">{t('predHistoryOnly')}</p>
                    <ReachStrip reaches={reaches} />
                    <p className="text-xs text-gray-400 mt-1">
                        {t('predSummary')
                            .replace('{n}', String(n))
                            .replace('{breakouts}', String(breakoutCount))
                            .replace('{threshold}', formatCount(breakoutThreshold))}
                    </p>
                    <p className="mt-3 text-sm text-gray-300 leading-relaxed">
                        {calibration.lockReason ?? t('predLockedGeneric')}{' '}
                        <span className="text-gray-500">{t('predLockedWhy')}</span>
                    </p>
                </>
            )}
        </div>
    );
}
