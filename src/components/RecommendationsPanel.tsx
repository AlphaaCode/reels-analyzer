'use client';

import React from 'react';
import Image from 'next/image';
import { pickText, useLang } from '@/lib/i18n';
import type { LocalizedText } from '@/types/analysis';

interface RecommendationsPanelProps {
    recommendations: LocalizedText[];
}

// Pick the icon that matches the recommendation's topic
function iconFor(recommendation: string): string {
    const text = recommendation.toLowerCase();
    if (/hook|first 3|opening/.test(text)) return '/bait.png';
    if (/audio|sound|music|loud/.test(text)) return '/spech.png';
    if (/visual|light|text|caption|read/.test(text)) return '/graphic-designer.png';
    if (/time|post|schedule/.test(text)) return '/clock.png';
    if (/cta|call to action|call-to-action|follow|comment|share|save|engage/.test(text)) return '/engagement.png';
    if (/shorten|trim|length|pacing|cut|second/.test(text)) return '/flash.png';
    if (/format|vertical|aspect|9:16|reformat/.test(text)) return '/statistics.png';
    return '/star.png';
}

export default function RecommendationsPanel({ recommendations }: RecommendationsPanelProps) {
    const { t, lang } = useLang();
    return (
        <div className="bg-gray-800/50 rounded-2xl border border-gray-700/50 overflow-hidden">
            <div className="p-6 border-b border-gray-700/50 bg-gray-800/80">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Image src="/star.png" alt="" width={28} height={28} className="w-7 h-7 object-contain" />
                    {t('recsTitle')}
                </h3>
                <p className="text-gray-400 text-sm mt-1">
                    {t('recsSub')}
                </p>
            </div>

            <div className="p-6">
                <div className="space-y-4">
                    {recommendations.map((rec, index) => (
                        <div
                            key={index}
                            className="flex gap-4 p-4 rounded-xl bg-gray-700/20 hover:bg-gray-700/40 transition-colors border border-gray-700/30 group"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-pink-500/20 to-orange-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Image src={iconFor(rec.en)} alt="" width={22} height={22} className="w-[22px] h-[22px] object-contain" />
                            </div>

                            <div>
                                <p className="text-gray-200 leading-relaxed">
                                    {/* Strip any decorative prefix the model may add */}
                                    {pickText(rec, lang).replace(/^[^\p{L}\p{N}"'(]+/u, '')}
                                </p>
                            </div>
                        </div>
                    ))}

                    {recommendations.length === 0 && (
                        <div className="text-center py-8 text-gray-500">
                            {t('recsEmpty')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
