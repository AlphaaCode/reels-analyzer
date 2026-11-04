// Keyless fallback — deterministic estimates from locally measured ffmpeg signals.
// Works with zero accounts and zero network; clearly labeled as signals-only.
// All output text is bilingual (en/ar) so the UI toggle switches instantly.

import { generateRecommendations, l } from '../analysis';
import { LOUDNESS_TARGET_LUFS } from '../constants';
import type {
    ActualPerformance,
    AIInsights,
    AnalysisMetrics,
    AnalysisProvider,
    LocalizedText,
    MetricAdvice,
    PerformanceReview,
    PerformanceVerdict,
    ProviderInput,
    TechnicalSignals
} from '@/types/analysis';

const clamp = (value: number, min = 1, max = 10): number =>
    Math.min(max, Math.max(min, Math.round(value)));

function opensSilent(s: TechnicalSignals): boolean {
    return s.silences.some(span => span.start <= 0.5 && span.end >= 2);
}

function endsSilent(s: TechnicalSignals): boolean {
    return s.duration > 0 &&
        s.silences.some(span => span.end >= s.duration - 1 && span.end - span.start >= 2);
}

function scoreMetrics(s: TechnicalSignals): AnalysisMetrics {
    let hookStrength = 5;
    if (s.cutsInFirstThreeSeconds >= 1) hookStrength += 1;
    if (s.cutsInFirstThreeSeconds >= 3) hookStrength += 1;
    if (opensSilent(s)) hookStrength -= 2;

    let visualQuality = 5;
    if (s.height >= 1920 && s.width >= 1080) visualQuality += 2;
    else if (s.height >= 1280) visualQuality += 1;
    else visualQuality -= 1;
    if (s.fps >= 30) visualQuality += 1;
    else if (s.fps > 0 && s.fps < 24) visualQuality -= 1;
    if (s.bitrateKbps > 0 && s.bitrateKbps < 1500) visualQuality -= 1;

    const cpm = s.cutsPerMinute;
    let pacing = 5;
    if (cpm >= 15 && cpm <= 40) pacing = 8;
    else if ((cpm >= 8 && cpm < 15) || (cpm > 40 && cpm <= 60)) pacing = 6;
    else if (cpm < 8) pacing = s.duration <= 15 ? 6 : 4;
    if (s.silences.some(span => span.end - span.start >= 2)) pacing -= 1;

    return {
        hookStrength: clamp(hookStrength, 2, 8),
        visualQuality: clamp(visualQuality, 2, 9),
        pacing: clamp(pacing),
        trendingElements: 5, // not measurable without AI — neutral
        engagementCTA: endsSilent(s) ? 4 : 5,
        rewatchPotential: s.duration >= 10 && s.duration <= 35 ? 7 : s.durationFit === 'optimal' ? 6 : 4
    };
}

function describeSignals(s: TechnicalSignals): { strengths: LocalizedText[]; improvements: LocalizedText[] } {
    const strengths: LocalizedText[] = [];
    const improvements: LocalizedText[] = [];

    if (s.isVertical) {
        strengths.push(l(
            `Perfect vertical ${s.aspectRatio} format for Reels`,
            `تنسيق عمودي مثالي ${s.aspectRatio} للريلز`
        ));
    } else {
        improvements.push(l(
            `Aspect ratio is ${s.aspectRatio} — export at 9:16 (1080×1920) so the Reel fills the screen`,
            `نسبة الأبعاد ${s.aspectRatio} — صدّر بمقاس 9:16 (1080×1920) ليملأ الريل الشاشة`
        ));
    }

    if (s.height >= 1920 && s.width >= 1080) {
        strengths.push(l(
            `Sharp ${s.width}×${s.height} source resolution`,
            `دقة مصدر عالية ${s.width}×${s.height}`
        ));
    } else {
        improvements.push(l(
            `Resolution is ${s.width}×${s.height} — export at 1080×1920 for a crisper feed impression`,
            `الدقة ${s.width}×${s.height} — صدّر بمقاس 1080×1920 لمظهر أكثر حدة`
        ));
    }

    if (s.fps >= 30) {
        strengths.push(l(`Smooth ${s.fps} fps footage`, `تصوير سلس بمعدل ${s.fps} إطارًا/ث`));
    } else if (s.fps > 0 && s.fps < 24) {
        improvements.push(l(
            `${s.fps} fps looks choppy on mobile — record/export at 30 fps or higher`,
            `${s.fps} إطارًا/ث يبدو متقطعًا على الهاتف — صوّر وصدّر بمعدل 30 أو أعلى`
        ));
    }

    if (s.loudnessLufs !== null) {
        const diff = s.loudnessLufs - LOUDNESS_TARGET_LUFS;
        if (Math.abs(diff) <= 2) {
            strengths.push(l(
                `Loudness ${s.loudnessLufs} LUFS sits right at the ${LOUDNESS_TARGET_LUFS} LUFS platform target`,
                `مستوى الصوت ${s.loudnessLufs} LUFS مطابق لهدف المنصة ${LOUDNESS_TARGET_LUFS}`
            ));
        } else if (diff < 0) {
            improvements.push(l(
                `Audio is quiet (${s.loudnessLufs} LUFS vs ${LOUDNESS_TARGET_LUFS} target) — raise it so it holds up on phone speakers`,
                `الصوت منخفض (${s.loudnessLufs} LUFS مقابل الهدف ${LOUDNESS_TARGET_LUFS}) — ارفعه ليبقى واضحًا على سماعات الهاتف`
            ));
        } else {
            improvements.push(l(
                `Audio is hot (${s.loudnessLufs} LUFS) — the platform will normalize it down; master closer to ${LOUDNESS_TARGET_LUFS} LUFS`,
                `الصوت مرتفع (${s.loudnessLufs} LUFS) — ستخفضه المنصة تلقائيًا؛ اضبطه قرب ${LOUDNESS_TARGET_LUFS} LUFS`
            ));
        }
    } else {
        improvements.push(l(
            'No audio track detected — Reels with sound/music massively outperform silent ones',
            'لا يوجد مسار صوتي — الريلز بصوت أو موسيقى تتفوق كثيرًا على الصامتة'
        ));
    }

    if (s.cutsPerMinute >= 15 && s.cutsPerMinute <= 40) {
        strengths.push(l(
            `Energetic pacing: ${s.cutCount} cuts (${s.cutsPerMinute}/min, avg shot ${s.avgShotSeconds}s)`,
            `إيقاع نشيط: ${s.cutCount} قطعة (${s.cutsPerMinute}/دقيقة، متوسط اللقطة ${s.avgShotSeconds} ث)`
        ));
    } else if (s.cutsPerMinute < 8 && s.duration > 15) {
        improvements.push(l(
            `Only ${s.cutCount} cut(s) in ${s.duration}s — add cuts, zooms, or text changes every 2–4s to fight drop-off`,
            `فقط ${s.cutCount} قطعة في ${s.duration} ث — أضف قطعًا أو تقريبًا أو نصوصًا كل 2–4 ثوانٍ لمقاومة الانسحاب`
        ));
    }

    if (s.cutsInFirstThreeSeconds === 0) {
        improvements.push(l(
            'No visual change in the first 3 seconds — front-load motion or a pattern interrupt',
            'لا تغيير بصري في أول 3 ثوانٍ — قدّم حركة أو كسر نمط في البداية'
        ));
    }

    const longSilences = s.silences.filter(span => span.end - span.start >= 2);
    if (longSilences.length) {
        const spans = longSilences.map(span => `${span.start}–${span.end}s`).join(', ');
        improvements.push(l(
            `Dead air at ${spans} — trim it or cover it with music`,
            `فراغ صوتي عند ${spans} — احذفه أو غطه بالموسيقى`
        ));
    }

    if (s.durationFit === 'short') {
        improvements.push(l(
            `${s.duration}s is short — 15–35s tends to maximize watch-through and shares`,
            `${s.duration} ث قصيرة — نطاق 15–35 ث يعظّم إكمال المشاهدة والمشاركات`
        ));
    }
    if (s.durationFit === 'long') {
        improvements.push(l(
            `${s.duration}s is long for a Reel — tighten toward 15–35s unless retention holds`,
            `${s.duration} ث طويلة للريل — قلّصها نحو 15–35 ث ما لم يصمد الاحتفاظ`
        ));
    }

    return { strengths: strengths.slice(0, 5), improvements: improvements.slice(0, 5) };
}

// Signals-grounded per-metric tips for the metric popup
function buildMetricAdvice(s: TechnicalSignals): MetricAdvice {
    const hookStrength: LocalizedText[] = [];
    if (s.cutsInFirstThreeSeconds === 0) {
        hookStrength.push(l(
            'Add a visual change (cut, zoom, or text pop) inside the first 3 seconds — none was measured',
            'أضف تغييرًا بصريًا (قطع أو تقريب أو نص) خلال أول 3 ثوانٍ — لم يُرصد أي تغيير'
        ));
    }
    if (opensSilent(s)) {
        hookStrength.push(l(
            'Start speech or music immediately — the opening is nearly silent',
            'ابدأ الكلام أو الموسيقى فورًا — الافتتاحية شبه صامتة'
        ));
    }
    hookStrength.push(l(
        'Open with a bold on-screen claim or question so scrollers know why to stay',
        'ابدأ بادعاء أو سؤال جريء على الشاشة ليعرف المتصفح لماذا يبقى'
    ));

    const visualQuality: LocalizedText[] = [];
    if (!(s.height >= 1920 && s.width >= 1080)) {
        visualQuality.push(l(
            `Export at 1080×1920 — current ${s.width}×${s.height} gets softened on phones`,
            `صدّر بمقاس 1080×1920 — الدقة الحالية ${s.width}×${s.height} تفقد حدتها على الهاتف`
        ));
    }
    if (s.fps > 0 && s.fps < 30) {
        visualQuality.push(l(
            `Record and export at 30+ fps (currently ${s.fps})`,
            `صوّر وصدّر بمعدل 30+ إطارًا/ث (حاليًا ${s.fps})`
        ));
    }
    if (s.bitrateKbps > 0 && s.bitrateKbps < 1500) {
        visualQuality.push(l(
            `Raise the export bitrate (currently ${s.bitrateKbps} kbps) — compression artifacts hurt perceived quality`,
            `ارفع معدل البت (حاليًا ${s.bitrateKbps} kbps) — تشوهات الضغط تضر بالجودة الملموسة`
        ));
    }
    if (s.loudnessLufs !== null && Math.abs(s.loudnessLufs - LOUDNESS_TARGET_LUFS) > 2) {
        visualQuality.push(l(
            `Master audio to about ${LOUDNESS_TARGET_LUFS} LUFS (currently ${s.loudnessLufs})`,
            `اضبط الصوت قرب ${LOUDNESS_TARGET_LUFS} LUFS (حاليًا ${s.loudnessLufs})`
        ));
    }
    if (!visualQuality.length) {
        visualQuality.push(l(
            'Technical checks pass — lighting, framing, and grade are the next levers',
            'الفحوص التقنية سليمة — الإضاءة والتأطير وتدرج الألوان هي الروافع التالية'
        ));
    }

    const pacing: LocalizedText[] = [];
    if (s.cutsPerMinute < 15) {
        pacing.push(l(
            `Change something every 2–4 seconds — currently ${s.cutsPerMinute} cuts/min`,
            `غيّر شيئًا كل 2–4 ثوانٍ — حاليًا ${s.cutsPerMinute} قطعة/دقيقة`
        ));
    }
    if (s.cutsPerMinute > 40) {
        pacing.push(l(
            `Pacing is frantic (${s.cutsPerMinute} cuts/min) — let key moments breathe`,
            `الإيقاع محموم (${s.cutsPerMinute} قطعة/دقيقة) — دع اللحظات المهمة تتنفس`
        ));
    }
    const longSilences = s.silences.filter(span => span.end - span.start >= 2);
    if (longSilences.length) {
        pacing.push(l(
            `Trim the dead air (${longSilences.map(x => `${x.start}–${x.end}s`).join(', ')}) or cover it with music`,
            `احذف الفراغ الصوتي (${longSilences.map(x => `${x.start}–${x.end} ث`).join('، ')}) أو غطه بالموسيقى`
        ));
    }
    if (!pacing.length) {
        pacing.push(l(
            `Cut rhythm is in the sweet spot (${s.cutsPerMinute}/min) — sync cuts to the audio beat for extra punch`,
            `إيقاع القطع في النطاق الأمثل (${s.cutsPerMinute}/دقيقة) — زامن القطع مع إيقاع الصوت لمزيد من القوة`
        ));
    }

    const engagementCTA: LocalizedText[] = [];
    if (endsSilent(s)) {
        engagementCTA.push(l(
            'The video ends quiet — close with a spoken or on-screen ask',
            'ينتهي الفيديو بهدوء — اختم بطلب منطوق أو نصي'
        ));
    }
    engagementCTA.push(l(
        'Ask one explicit action (comment / save / share) in the last 3 seconds',
        'اطلب فعلًا واحدًا صريحًا (تعليق / حفظ / مشاركة) في آخر 3 ثوانٍ'
    ));
    engagementCTA.push(l(
        'Show the ask as on-screen text, not just voice',
        'اعرض الطلب نصًا على الشاشة لا صوتًا فقط'
    ));

    const rewatchPotential: LocalizedText[] = [];
    if (s.duration > 35) {
        rewatchPotential.push(l(
            `Tighten toward 15–35s (currently ${s.duration}s) — shorter clips loop and re-watch better`,
            `قلّص المدة نحو 15–35 ث (حاليًا ${s.duration} ث) — المقاطع الأقصر تتكرر وتُعاد مشاهدتها أكثر`
        ));
    }
    rewatchPotential.push(l(
        'End mid-motion so the loop back to the start feels seamless',
        'اختم في منتصف الحركة ليبدو الرجوع إلى البداية سلسًا'
    ));

    return {
        hookStrength,
        visualQuality,
        pacing,
        trendingElements: [
            l(
                'Not measurable locally — pick a rising sound from the Reels tab and duck it under your audio',
                'غير قابل للقياس محليًا — اختر صوتًا صاعدًا من تبويب الريلز واخفضه تحت صوتك'
            ),
            l(
                'Adapt a current format (green screen, text reply, POV) to your topic',
                'كيّف صيغة رائجة (شاشة خضراء، رد نصي، POV) مع موضوعك'
            )
        ],
        engagementCTA,
        rewatchPotential
    };
}

// Simple expectation model: a typical reel reaches ~5-30% of followers
function buildPerformanceReview(actual: ActualPerformance): PerformanceReview {
    const ratio = actual.followers > 0 ? actual.views / actual.followers : 0;
    const verdict: PerformanceVerdict =
        ratio > 0.35 ? 'overperformed' : ratio >= 0.08 ? 'as-expected' : 'underperformed';

    const why: LocalizedText[] = [
        l(
            `Views reached ${(ratio * 100).toFixed(1)}% of followers (typical range 5-30%)`,
            `المشاهدات بلغت ${(ratio * 100).toFixed(1)}% من المتابعين (النطاق المعتاد 5-30%)`
        )
    ];
    if (actual.shares > actual.saved * 1.5 && actual.shares > 5) {
        why.push(l(
            `Shares (${actual.shares}) far exceed saves (${actual.saved}) — it spread as a forwarded message`,
            `المشاركات (${actual.shares}) تفوق الحفظ (${actual.saved}) بكثير — انتشر كرسالة يعاد توجيهها`
        ));
    }
    if (actual.views > actual.reach * 1.4 && actual.reach > 0) {
        why.push(l(
            `Views are ${(actual.views / actual.reach).toFixed(1)}x reach — strong rewatch/loop behavior`,
            `المشاهدات ${(actual.views / actual.reach).toFixed(1)} ضعف الوصول — إعادة مشاهدة قوية`
        ));
    }
    if (verdict === 'underperformed' && actual.views > 0 && actual.likes / actual.views > 0.05) {
        why.push(l(
            `Like-rate is healthy (${((actual.likes / actual.views) * 100).toFixed(1)}%) despite low views — distribution never picked it up`,
            `معدل الإعجاب جيد (${((actual.likes / actual.views) * 100).toFixed(1)}%) رغم قلة المشاهدات — التوزيع لم يلتقطه`
        ));
    }

    const next: LocalizedText[] = [
        verdict === 'underperformed'
            ? l(
                'Repost the theme with a stronger first-3-seconds pattern interrupt',
                'أعد نشر الفكرة مع كسر نمط أقوى في أول 3 ثوانٍ'
            )
            : l(
                'Repeat this format while the pattern is working',
                'كرر هذه الصيغة ما دامت ناجحة'
            ),
        l(
            'Add a free Gemini key for a content-aware diagnosis of this gap',
            'أضف مفتاح Gemini المجاني لتشخيص واعٍ بالمحتوى لهذه الفجوة'
        )
    ];

    return { verdict, whyItHappened: why, whatToDoNext: next };
}

export const heuristicProvider: AnalysisProvider = {
    name: 'heuristic',
    async analyze({ signals, actual }: ProviderInput): Promise<AIInsights> {
        const metrics = scoreMetrics(signals);
        const { strengths, improvements } = describeSignals(signals);
        const silentOpening = opensSilent(signals);

        return {
            metrics,
            strengths,
            improvements,
            summary: l(
                `Signals-only estimate (no AI): ${signals.duration}s ${signals.aspectRatio} video with ` +
                    `${signals.cutCount} cuts (${signals.cutsPerMinute}/min)` +
                    (signals.loudnessLufs !== null ? ` at ${signals.loudnessLufs} LUFS` : ', no audio') +
                    '. Scores reflect technical execution — add a free Gemini key for content-aware analysis.',
                `تقدير من الإشارات فقط (بدون ذكاء اصطناعي): فيديو ${signals.duration} ث بنسبة ${signals.aspectRatio} ` +
                    `مع ${signals.cutCount} قطعة (${signals.cutsPerMinute}/دقيقة)` +
                    (signals.loudnessLufs !== null ? ` بمستوى ${signals.loudnessLufs} LUFS` : '، بدون صوت') +
                    '. الدرجات تعكس التنفيذ التقني — أضف مفتاح Gemini المجاني لتحليل واعٍ بالمحتوى.'
            ),
            recommendations: generateRecommendations(metrics),
            hookVerdict: l(
                `Measured only: ${signals.cutsInFirstThreeSeconds} visual cut(s) in the first 3 seconds` +
                    `${silentOpening ? ' and the opening is nearly silent — risky for retention' : ''}.`,
                `قياس فقط: ${signals.cutsInFirstThreeSeconds} قطعة بصرية في أول 3 ثوانٍ` +
                    `${silentOpening ? ' والافتتاحية شبه صامتة — خطر على الاحتفاظ' : ''}.`
            ),
            metricAdvice: buildMetricAdvice(signals),
            performanceReview: actual ? buildPerformanceReview(actual) : undefined
        };
    }
};
