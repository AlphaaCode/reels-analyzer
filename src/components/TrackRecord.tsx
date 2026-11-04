'use client';

// Account-level, so it lives on the home page rather than inside one reel's
// results. Reads as a lab notebook: what the app has measured about its own
// accuracy, including the parts that are unflattering.

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useLang, type Lang } from '@/lib/i18n';
import ReachStrip, { formatCount } from './ReachStrip';

interface Predictor { key: string; rho: number; p: number; pAdjusted?: number }

interface CalibrationView {
    n: number;
    unlocked: boolean;
    lockReason?: string;
    alarm?: string;
    score: Predictor;
    scoreRaw: Predictor;
    recencyRho: number;
    survivors: string[];
    exploratory: Predictor[];
    noiseFloor?: { runs: number; metricSpread: Record<string, number>; unusableMetrics: string[] };
    breakoutThreshold: number;
    breakoutCount: number;
    reaches: number[];
    instruments: Record<string, number>;
}

const PREDICTOR_NAMES: Record<string, Record<Lang, string>> = {
    cutsPerMinute: { en: 'cuts per minute', ar: 'القطعات في الدقيقة' },
    avgShotSeconds: { en: 'average shot length', ar: 'متوسط طول اللقطة' },
    loudnessLufs: { en: 'loudness', ar: 'مستوى الصوت' },
    duration: { en: 'duration', ar: 'المدة' },
    cutsInFirstThreeSeconds: { en: 'cuts in first 3s', ar: 'قطعات أول 3 ثوانٍ' },
    hookStrength: { en: 'hook strength (AI)', ar: 'قوة الجذب (ذكاء اصطناعي)' },
    visualQuality: { en: 'visual quality (AI)', ar: 'الجودة البصرية (ذكاء اصطناعي)' },
    pacing: { en: 'pacing (AI)', ar: 'الإيقاع (ذكاء اصطناعي)' },
    trendingElements: { en: 'trending elements (AI)', ar: 'عناصر الترند (ذكاء اصطناعي)' },
    engagementCTA: { en: 'engagement CTA (AI)', ar: 'دعوة التفاعل (ذكاء اصطناعي)' },
    rewatchPotential: { en: 'rewatch value (AI)', ar: 'إعادة المشاهدة (ذكاء اصطناعي)' }
};

export default function TrackRecord() {
    const { t, lang } = useLang();
    const [data, setData] = useState<CalibrationView | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/calibration')
            .then(res => (res.ok ? res.json() : null))
            .then(payload => {
                if (!cancelled && payload?.data) setData(payload.data);
            })
            .catch(() => {
                // no calibration yet — the panel simply stays hidden
            });
        return () => { cancelled = true; };
    }, []);

    if (!data || data.n === 0) return null;

    const name = (key: string) => PREDICTOR_NAMES[key]?.[lang] ?? key;
    const row = (label: string, value: string, tone = 'text-gray-300') => (
        <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-gray-700/40 last:border-0">
            <span className="text-xs text-gray-500">{label}</span>
            <span className={`text-xs font-medium ${tone} text-end`}>{value}</span>
        </div>
    );

    return (
        <section className="max-w-5xl mx-auto mt-12 animate-fade-in">
            <div className="flex items-center gap-2 mb-1">
                <Image src="/arrow.png" alt="" width={22} height={22} className="w-[22px] h-[22px] object-contain" />
                <h3 className="text-lg font-bold text-white">{t('trackTitle')}</h3>
                <span className={`px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${
                    data.unlocked
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-gray-700/40 border-gray-600 text-gray-300'
                }`}>
                    {data.unlocked ? t('predBadgeCalibrated') : t('predBadgeLocked')}
                </span>
            </div>
            <p className="text-xs text-gray-600 mb-4">{t('trackSub')}</p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl bg-gray-800/50 border border-gray-700/50">
                    <ReachStrip reaches={data.reaches} />
                    <p className="text-xs text-gray-400 mb-3">
                        {t('predSummary')
                            .replace('{n}', String(data.n))
                            .replace('{breakouts}', String(data.breakoutCount))
                            .replace('{threshold}', formatCount(data.breakoutThreshold))}
                    </p>
                    {row(t('trackScoreVsReach'), `rho ${data.score.rho.toFixed(2)} · p ${data.score.p.toFixed(2)}`,
                        data.unlocked ? 'text-emerald-400' : 'text-amber-400')}
                    {row(t('trackRecency'), `rho ${data.recencyRho.toFixed(2)}`)}
                    {data.noiseFloor && row(
                        t('trackNoise'),
                        `${Math.max(...Object.values(data.noiseFloor.metricSpread)).toFixed(0)} pts over ${data.noiseFloor.runs} runs`
                    )}
                    {row(t('trackInstrument'), Object.entries(data.instruments)
                        .filter(([key]) => !key.startsWith('heuristic'))
                        .map(([key, count]) => `${key.split('/').pop()} ×${count}`)
                        .join(' · ') || '—')}
                </div>

                <div className="p-5 rounded-2xl bg-gray-800/50 border border-gray-700/50">
                    <h4 className="text-sm font-semibold text-gray-300 mb-2">{t('trackPredictors')}</h4>
                    <ul className="space-y-2">
                        {data.exploratory.map(predictor => {
                            const survived = data.survivors.includes(predictor.key);
                            return (
                                <li key={predictor.key} className="flex items-center justify-between gap-3 text-sm">
                                    <span className={survived ? 'text-emerald-300' : 'text-gray-400'}>
                                        {name(predictor.key)}
                                    </span>
                                    <span className={`text-xs tabular-nums ${survived ? 'text-emerald-400' : 'text-gray-500'}`} dir="ltr">
                                        {predictor.rho >= 0 ? '+' : ''}{predictor.rho.toFixed(2)}
                                        {survived ? ` · ${t('trackHolds')}` : ''}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="mt-3 text-xs text-gray-500 leading-relaxed">{t('trackPredictorsNote')}</p>
                </div>
            </div>
        </section>
    );
}
