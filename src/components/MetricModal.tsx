'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { pickText, useLang } from '@/lib/i18n';
import type { LocalizedText, ProviderName } from '@/types/analysis';
import type { MetricInfo } from './MetricsGrid';

interface MetricModalProps {
    info: MetricInfo;
    score: number;
    advice: LocalizedText[]; // per-video tips from the analysis provider
    facts: string[];         // measured signals relevant to this metric
    provider?: ProviderName;
    onClose: () => void;
}

export default function MetricModal({ info, score, advice, facts, provider, onClose }: MetricModalProps) {
    const { t, lang } = useLang();
    // Only ever mounted by a click (never during SSR), so document is safe here.
    // Lock page scroll while the popup is open.
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const scoreColor =
        score >= 8 ? 'text-green-400' :
        score >= 6 ? 'text-pink-400' :
        score >= 4 ? 'text-orange-400' : 'text-red-400';
    const barColor =
        score >= 8 ? 'from-green-500 to-emerald-400' :
        score >= 6 ? 'from-pink-500 to-orange-400' :
        score >= 4 ? 'from-orange-500 to-amber-400' : 'from-red-500 to-orange-400';

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={`How to improve ${info.label}`}
        >
            <div
                className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl p-6 shadow-2xl shadow-black/50"
                onClick={event => event.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                        <Image src={info.icon} alt="" width={36} height={36} className="w-9 h-9 object-contain" />
                        <div>
                            <h3 className="text-xl font-bold text-white">{info.label}</h3>
                            <p className="text-xs text-gray-500">{info.description}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="text-gray-500 hover:text-white text-2xl leading-none transition-colors"
                    >
                        ×
                    </button>
                </div>

                {/* Score */}
                <div className="flex items-center gap-3 mb-2">
                    <span className={`text-4xl font-bold ${scoreColor}`}>{score}</span>
                    <span className="text-gray-500 text-sm">/ 10</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-4">
                    <div
                        className={`h-full bg-gradient-to-r ${barColor} rounded-full`}
                        style={{ width: `${score * 10}%` }}
                    />
                </div>

                <p className="text-sm text-gray-400 mb-5">{info.about}</p>

                {/* Measured facts */}
                {facts.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-5">
                        {facts.map(fact => (
                            <span
                                key={fact}
                                className="px-2.5 py-1 text-xs rounded-full bg-gray-800 border border-gray-700 text-gray-300"
                            >
                                {fact}
                            </span>
                        ))}
                    </div>
                )}

                {/* Per-video advice */}
                {advice.length > 0 && (
                    <div className="mb-5 p-4 rounded-xl bg-pink-500/5 border border-pink-500/20">
                        <h4 className="text-sm font-semibold text-pink-300 mb-2">
                            {provider !== 'heuristic' ? t('modalForVideoAI') : t('modalForVideoMeasured')}
                        </h4>
                        <ul className="space-y-2">
                            {advice.map(tip => (
                                <li key={tip.en} className="flex gap-2 text-sm text-gray-200 leading-relaxed">
                                    <span className="text-pink-400 mt-0.5">▸</span>
                                    <span>{pickText(tip, lang)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Generic playbook */}
                <div className="mb-6">
                    <h4 className="text-sm font-semibold text-gray-300 mb-2">{t('modalPlaybook')}</h4>
                    <ul className="space-y-2">
                        {info.playbook.map(tip => (
                            <li key={tip} className="flex gap-2 text-sm text-gray-400 leading-relaxed">
                                <span className="text-gray-600 mt-0.5">▸</span>
                                <span>{tip}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <button
                    onClick={onClose}
                    className="w-full py-2.5 px-4 rounded-xl bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
                >
                    {t('modalGotIt')}
                </button>
            </div>
        </div>,
        document.body
    );
}
