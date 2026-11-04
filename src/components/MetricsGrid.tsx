'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import MetricModal from './MetricModal';
import { useLang, type Lang } from '@/lib/i18n';
import type { AnalysisMetrics, HookAnalysis, MetricAdvice, MetricKey, ProviderName, TechnicalSignals } from '@/types/analysis';

export interface MetricInfo {
    label: string;
    description: string;
    icon: string;
    about: string;
    playbook: string[];
}

const METRIC_ICONS: Record<MetricKey, string> = {
    hookStrength: '/fishing-hook.png',
    visualQuality: '/graphic-designer.png',
    pacing: '/flash.png',
    trendingElements: '/statistics.png',
    engagementCTA: '/engagement.png',
    rewatchPotential: '/refresh.png'
};

type MetricText = Record<MetricKey, Omit<MetricInfo, 'icon'>>;

const METRIC_TEXT: Record<Lang, MetricText> = {
    en: {
        hookStrength: {
            label: 'Hook Strength',
            description: 'First 3 seconds engagement',
            about: "Whether the first 3 seconds stop the scroll — visually AND in what's said or shown. Most viewers decide to stay or swipe right here, which is why this metric carries the biggest weight (25%).",
            playbook: [
                'Open with a pattern interrupt — motion, a bold claim, or an unexpected visual in second one',
                'Put the payoff first, the explanation after',
                'Overlay the opening line as big on-screen text',
                'Cut or zoom at least once inside the first 3 seconds'
            ]
        },
        visualQuality: {
            label: 'Visual Quality',
            description: 'Composition & clarity',
            about: 'Production quality: sharpness, lighting, framing, editing polish, and clean audio. Viewers read quality in the first frame — soft or dark footage gets swiped reflexively.',
            playbook: [
                'Export vertical 1080×1920 at 30+ fps',
                'Light the subject brighter than the background',
                'Stabilize: tripod, gimbal, or post-stabilization',
                'Master audio to −14 LUFS so it holds up on phone speakers'
            ]
        },
        pacing: {
            label: 'Pacing & Retention',
            description: 'Content flow & rhythm',
            about: 'The rhythm that holds attention: cut frequency, shot variety, and zero dead air. Retention is the single strongest ranking signal — pacing is how you defend it (20% weight).',
            playbook: [
                'Change something every 2–4 seconds: cut, zoom, text, or angle',
                'Cut on the beat of the music',
                'Trim every pause — dead air kills retention',
                'Front-load value; save the slow build for long-form'
            ]
        },
        trendingElements: {
            label: 'Trending Elements',
            description: 'Audio, formats & effects',
            about: 'How much the video rides current sounds, formats, and cultural moments. Trending audio alone can lift reach 15–20% because the algorithm groups your Reel with a hot cluster.',
            playbook: [
                'Pick a rising sound from the Reels tab and duck it under your voice',
                'Adapt a current format (green screen, text reply, POV) to your topic',
                'Jump trends early — they decay in days',
                'Mix 3–5 topical hashtags with broad ones'
            ]
        },
        engagementCTA: {
            label: 'Engagement CTA',
            description: 'Call-to-action clarity',
            about: 'How clearly viewers are prompted to comment, save, share, or follow. Comments and shares are weighted far above likes — but people rarely act without being asked.',
            playbook: [
                'End with ONE explicit ask: comment, save, share, or follow — not all four',
                'Ask a question people can answer in one word',
                'Show the ask as on-screen text, not just voice',
                'Reply to early comments fast to feed the algorithm'
            ]
        },
        rewatchPotential: {
            label: 'Rewatch Value',
            description: 'Shareability & replay',
            about: "How likely someone watches twice or lets it loop — the algorithm's favorite signal, because >100% watch time marks a video as unusually engaging.",
            playbook: [
                'Keep it 15–35 seconds — short enough to loop',
                'End mid-motion so the loop back feels seamless',
                'Hide a detail viewers only catch the second time',
                'Deliver dense value: one strong idea per 10 seconds'
            ]
        }
    },
    ar: {
        hookStrength: {
            label: 'قوة الجذب',
            description: 'تفاعل أول 3 ثوانٍ',
            about: 'هل توقف أول 3 ثوانٍ التمرير — بصريًا وفي الكلام أو النص الظاهر؟ هنا يقرر معظم المشاهدين البقاء أو الانصراف، لذلك يحمل هذا المقياس الوزن الأكبر (25%).',
            playbook: [
                'ابدأ بكسر النمط — حركة أو ادعاء جريء أو مشهد غير متوقع في الثانية الأولى',
                'قدّم النتيجة أولًا ثم الشرح بعدها',
                'اعرض الجملة الافتتاحية كنص كبير على الشاشة',
                'أضف قطعًا أو تقريبًا واحدًا على الأقل خلال أول 3 ثوانٍ'
            ]
        },
        visualQuality: {
            label: 'الجودة البصرية',
            description: 'التكوين والوضوح',
            about: 'جودة الإنتاج: الحدة والإضاءة والتأطير وإتقان المونتاج ونقاء الصوت. يحكم المشاهد على الجودة من أول إطار — واللقطة الباهتة أو المظلمة تُمرَّر فورًا.',
            playbook: [
                'صدّر الفيديو عموديًا 1080×1920 بمعدل 30+ إطارًا في الثانية',
                'أضئ الوجه أو الموضوع أكثر من الخلفية',
                'ثبّت الكاميرا: حامل ثلاثي أو مثبّت أو معالجة لاحقة',
                'اضبط الصوت عند ‎-14 LUFS ليبقى واضحًا على سماعات الهاتف'
            ]
        },
        pacing: {
            label: 'الإيقاع والاحتفاظ',
            description: 'تدفق المحتوى وإيقاعه',
            about: 'الإيقاع الذي يمسك الانتباه: تواتر القطع وتنوع اللقطات وغياب الفراغات. الاحتفاظ بالمشاهد أقوى إشارة ترتيب في الخوارزمية — والإيقاع هو خط دفاعك عنه (وزن 20%).',
            playbook: [
                'غيّر شيئًا كل 2–4 ثوانٍ: قطع أو تقريب أو نص أو زاوية',
                'اقطع على إيقاع الموسيقى',
                'احذف كل توقف — الفراغ يقتل الاحتفاظ',
                'قدّم القيمة مبكرًا واترك التمهيد الطويل للمحتوى الطويل'
            ]
        },
        trendingElements: {
            label: 'عناصر الترند',
            description: 'الأصوات والصيغ والمؤثرات',
            about: 'مدى ركوب الفيديو للأصوات والصيغ واللحظات الرائجة. الصوت الرائج وحده قد يرفع الوصول 15–20% لأن الخوارزمية تضع الريل ضمن موجة نشطة.',
            playbook: [
                'اختر صوتًا صاعدًا من تبويب الريلز واخفضه تحت صوتك',
                'كيّف صيغة رائجة (شاشة خضراء، رد نصي، POV) مع موضوعك',
                'اركب الترند مبكرًا — فهو يتلاشى خلال أيام',
                'امزج 3–5 هاشتاقات متخصصة مع هاشتاقات عامة'
            ]
        },
        engagementCTA: {
            label: 'دعوة التفاعل',
            description: 'وضوح الدعوة إلى الفعل',
            about: 'مدى وضوح دعوة المشاهد إلى التعليق أو الحفظ أو المشاركة أو المتابعة. التعليقات والمشاركات توزن أعلى بكثير من الإعجابات — والناس نادرًا ما يتفاعلون دون طلب صريح.',
            playbook: [
                'اختم بطلب واحد صريح: علّق أو احفظ أو شارك أو تابع — وليس كلها معًا',
                'اطرح سؤالًا يمكن الإجابة عنه بكلمة واحدة',
                'اعرض الطلب نصًا على الشاشة لا صوتًا فقط',
                'رد على التعليقات المبكرة بسرعة لتغذية الخوارزمية'
            ]
        },
        rewatchPotential: {
            label: 'قيمة إعادة المشاهدة',
            description: 'قابلية المشاركة والتكرار',
            about: 'احتمال أن يشاهد أحدهم الفيديو مرتين أو يتركه يتكرر — الإشارة المفضلة للخوارزمية، لأن تجاوز 100% من مدة المشاهدة يصنّف الفيديو استثنائيًا.',
            playbook: [
                'أبق الفيديو بين 15–35 ثانية — قصيرًا بما يكفي ليتكرر',
                'اختم في منتصف الحركة ليبدو الرجوع إلى البداية سلسًا',
                'أخفِ تفصيلة لا تُلتقط إلا في المشاهدة الثانية',
                'قدّم قيمة كثيفة: فكرة قوية كل 10 ثوانٍ'
            ]
        }
    }
};

export function getMetricInfo(lang: Lang): Record<MetricKey, MetricInfo> {
    const text = METRIC_TEXT[lang];
    return (Object.keys(METRIC_ICONS) as MetricKey[]).reduce((acc, key) => {
        acc[key] = { ...text[key], icon: METRIC_ICONS[key] };
        return acc;
    }, {} as Record<MetricKey, MetricInfo>);
}

// Measured signals worth surfacing inside each metric's popup
function factsFor(key: MetricKey, technical?: TechnicalSignals, hook?: HookAnalysis): string[] {
    if (!technical) return [];
    switch (key) {
        case 'hookStrength':
            return [`${hook?.cutsInFirstThreeSeconds ?? technical.cutsInFirstThreeSeconds} cut(s) / 3s`];
        case 'visualQuality':
            return [
                `${technical.width}×${technical.height}`,
                `${technical.fps} fps`,
                `${technical.bitrateKbps} kbps`,
                technical.loudnessLufs === null ? '—' : `${technical.loudnessLufs} LUFS`
            ];
        case 'pacing':
            return [
                `${technical.cutsPerMinute} cuts/min`,
                `${technical.avgShotSeconds}s`,
                `${technical.silences.length} ≥1s`
            ];
        case 'rewatchPotential':
            return [`${technical.duration}s (${technical.durationFit})`];
        default:
            return [];
    }
}

interface MetricsGridProps {
    metrics: AnalysisMetrics;
    advice?: MetricAdvice;
    technical?: TechnicalSignals;
    hook?: HookAnalysis;
    provider?: ProviderName;
}

export default function MetricsGrid({ metrics, advice, technical, hook, provider }: MetricsGridProps) {
    const { lang, t } = useLang();
    const [activeKey, setActiveKey] = useState<MetricKey | null>(null);
    const info = getMetricInfo(lang);

    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(Object.keys(METRIC_ICONS) as MetricKey[]).map((key, index) => (
                    <MetricCard
                        key={key}
                        info={info[key]}
                        score={metrics[key]}
                        delay={index * 100}
                        clickHint={t('cardClickHint')}
                        onClick={() => setActiveKey(key)}
                    />
                ))}
            </div>

            {activeKey && (
                <MetricModal
                    info={info[activeKey]}
                    score={metrics[activeKey]}
                    advice={advice?.[activeKey] ?? []}
                    facts={factsFor(activeKey, technical, hook)}
                    provider={provider}
                    onClose={() => setActiveKey(null)}
                />
            )}
        </>
    );
}

interface MetricCardProps {
    info: MetricInfo;
    score: number;
    delay: number;
    clickHint: string;
    onClick: () => void;
}

function MetricCard({ info, score, delay, clickHint, onClick }: MetricCardProps) {
    const [animated, setAnimated] = React.useState(false);

    React.useEffect(() => {
        const timer = setTimeout(() => setAnimated(true), delay);
        return () => clearTimeout(timer);
    }, [delay]);

    // Color based on score
    const getScoreColor = (s: number) => {
        if (s >= 8) return 'text-green-400';
        if (s >= 6) return 'text-pink-400';
        if (s >= 4) return 'text-orange-400';
        return 'text-red-400';
    };

    const getBarColor = (s: number) => {
        if (s >= 8) return 'from-green-500 to-emerald-400';
        if (s >= 6) return 'from-pink-500 to-orange-400';
        if (s >= 4) return 'from-orange-500 to-amber-400';
        return 'from-red-500 to-orange-400';
    };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`
        p-4 rounded-xl bg-gray-800/50 border border-gray-700/50 text-start w-full
        transform transition-all duration-500 cursor-pointer
        ${animated ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}
        hover:border-pink-500/40 hover:bg-gray-800/70 focus:outline-none focus:border-pink-500/60
      `}
        >
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Image src={info.icon} alt="" width={28} height={28} className="w-7 h-7 object-contain" />
                    <div>
                        <h4 className="font-medium text-white text-sm">{info.label}</h4>
                        <p className="text-xs text-gray-500">{info.description}</p>
                    </div>
                </div>
                <span className={`text-2xl font-bold ${getScoreColor(score)}`}>
                    {score}
                </span>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                    className={`h-full bg-gradient-to-r ${getBarColor(score)} rounded-full transition-all duration-1000 ease-out`}
                    style={{ width: animated ? `${score * 10}%` : '0%' }}
                />
            </div>

            {/* Score indicator */}
            <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>1</span>
                <span>10</span>
            </div>

            <p className="mt-2 text-center text-xs text-pink-400/70">{clickHint}</p>
        </button>
    );
}
