'use client';

import React, { useEffect, useState } from 'react';
import { useLang, type StringKey } from '@/lib/i18n';
import type { AnalysisStage } from '@/types/analysis';

// The pipeline as the server reports it. Stages a given run skips (no audio,
// or a provider that ingests the video directly) flash past as done.
const STAGES: { stage: AnalysisStage; key: StringKey; percent: number }[] = [
    { stage: 'signals', key: 'stageSignals', percent: 10 },
    { stage: 'thumbs', key: 'stageThumbs', percent: 25 },
    { stage: 'frames', key: 'stageFrames', percent: 38 },
    { stage: 'transcript', key: 'stageTranscript', percent: 48 },
    { stage: 'ai', key: 'stageAI', percent: 62 },
    { stage: 'scoring', key: 'stageScore', percent: 92 }
];

interface LoadingSpinnerProps {
    stage: AnalysisStage;
    startedAt: number;
}

export default function LoadingSpinner({ stage, startedAt }: LoadingSpinnerProps) {
    const { t } = useLang();
    const [elapsed, setElapsed] = useState(0);

    // A ticking clock is the honest liveness signal — the bar only moves when
    // the server actually reaches the next stage, and the AI stage is long
    useEffect(() => {
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [startedAt]);

    const current = Math.max(0, STAGES.findIndex(s => s.stage === stage));
    const minutes = Math.floor(elapsed / 60);
    const seconds = String(elapsed % 60).padStart(2, '0');

    return (
        <div className="w-full max-w-md mx-auto text-center py-12">
            {/* Animated gradient circle */}
            <div className="relative w-32 h-32 mx-auto mb-8">
                {/* Outer rotating ring */}
                <div className="absolute inset-0 rounded-full border-4 border-transparent bg-gradient-to-r from-pink-500 via-red-500 to-orange-500 animate-spin" style={{
                    backgroundClip: 'padding-box',
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                    padding: '4px'
                }} />

                {/* Inner pulsing circle */}
                <div className="absolute inset-4 rounded-full bg-gradient-to-br from-pink-500/20 to-orange-500/20 animate-pulse flex items-center justify-center">
                    <svg className="w-12 h-12 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                </div>
            </div>

            <h3 className="text-2xl font-semibold text-white mb-2 tabular-nums" dir="ltr">{minutes}:{seconds}</h3>
            <p className="text-gray-400 mb-6">{t('loadingNote')}</p>

            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                    className="h-full bg-gradient-to-r from-pink-500 to-orange-500 transition-all duration-500"
                    style={{ width: `${STAGES[current].percent}%` }}
                />
            </div>

            {/* Where the pipeline actually is, reported by the server */}
            <div className="mt-8 space-y-3">
                {STAGES.map((s, i) => (
                    <Step key={s.stage} label={t(s.key)} active={i === current} done={i < current} />
                ))}
            </div>
        </div>
    );
}

function Step({ label, active = false, done = false }: { label: string; active?: boolean; done?: boolean }) {
    return (
        <div className={`flex items-center gap-3 text-sm ${active ? 'text-pink-400' : done ? 'text-green-400' : 'text-gray-500'}`}>
            {done ? (
                <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
            ) : active ? (
                <svg className="w-5 h-5 flex-shrink-0 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
            ) : (
                <div className="w-5 h-5 flex-shrink-0 rounded-full border-2 border-current" />
            )}
            <span>{label}</span>
        </div>
    );
}
