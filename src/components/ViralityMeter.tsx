'use client';

import React from 'react';
import { getViralLevel } from '@/types/analysis';
import { useLang } from '@/lib/i18n';

interface ViralityMeterProps {
    score: number;
    animated?: boolean;
}

export default function ViralityMeter({ score, animated = true }: ViralityMeterProps) {
    const { t } = useLang();
    const { level } = getViralLevel(score);
    const levelLabel = {
        'very-high': t('levelVeryHigh'),
        'high': t('levelHigh'),
        'medium': t('levelMedium'),
        'low': t('levelLow'),
        'very-low': t('levelVeryLow')
    }[level];
    const [displayScore, setDisplayScore] = React.useState(animated ? 0 : score);

    React.useEffect(() => {
        if (!animated) {
            setDisplayScore(score);
            return;
        }

        // Animate score counting up
        const duration = 2000; // 2 seconds
        const steps = 60;
        const increment = score / steps;
        let current = 0;

        const timer = setInterval(() => {
            current += increment;
            if (current >= score) {
                setDisplayScore(score);
                clearInterval(timer);
            } else {
                setDisplayScore(Math.round(current));
            }
        }, duration / steps);

        return () => clearInterval(timer);
    }, [score, animated]);

    // Calculate gradient colors based on score
    const getGradientColors = (s: number) => {
        if (s >= 80) return { from: '#10b981', to: '#34d399' }; // Green for very high
        if (s >= 60) return { from: '#ec4899', to: '#f97316' }; // Pink-orange for high
        if (s >= 40) return { from: '#f97316', to: '#eab308' }; // Orange-yellow for medium
        if (s >= 20) return { from: '#f59e0b', to: '#ef4444' }; // Amber-red for low
        return { from: '#ef4444', to: '#dc2626' }; // Red for very low
    };

    const colors = getGradientColors(score);
    const circumference = 2 * Math.PI * 90; // radius = 90
    const strokeDashoffset = circumference - (displayScore / 100) * circumference;

    return (
        <div className="flex flex-col items-center">
            {/* Score Circle */}
            <div className="relative w-56 h-56">
                {/* Background circle */}
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
                    <defs>
                        <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={colors.from} />
                            <stop offset="100%" stopColor={colors.to} />
                        </linearGradient>
                    </defs>

                    {/* Background track */}
                    <circle
                        cx="100"
                        cy="100"
                        r="90"
                        fill="none"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth="12"
                    />

                    {/* Progress arc */}
                    <circle
                        cx="100"
                        cy="100"
                        r="90"
                        fill="none"
                        stroke="url(#scoreGradient)"
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-1000 ease-out"
                    />
                </svg>

                {/* Score display */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-6xl font-bold bg-gradient-to-r from-pink-400 to-orange-400 bg-clip-text text-transparent">
                        {displayScore}
                    </span>
                    <span className="text-gray-400 text-lg">/ 100</span>
                </div>
            </div>

            {/* Viral level label */}
            <div className={`
        mt-4 px-6 py-2 rounded-full text-lg font-semibold
        ${score >= 80 ? 'bg-green-500/20 text-green-400' :
                    score >= 60 ? 'bg-pink-500/20 text-pink-400' :
                        score >= 40 ? 'bg-orange-500/20 text-orange-400' :
                            score >= 20 ? 'bg-amber-500/20 text-amber-400' :
                                'bg-red-500/20 text-red-400'}
      `}>
                {t('viralPotentialTpl').replace('{level}', levelLabel)}
            </div>
        </div>
    );
}
