// Analysis scoring utilities

import { METRIC_WEIGHTS, REACH_ESTIMATES, FOLLOWER_REACH_BANDS, BEST_POST_TIMES } from './constants';
import type { ActualPerformance, CalibrationSummary, AnalysisMetrics, AnalysisResult, HookAnalysis, LocalizedText, MetricAdvice, PerformanceReview, PerformanceVerdict, ProviderName, TechnicalSignals } from '@/types/analysis';

// Shorthand for AI-written text carried in both app languages
export const l = (en: string, ar: string): LocalizedText => ({ en, ar });

/**
 * Calculate weighted virality score from individual metrics
 * Formula: (Hook×0.25 + Visual×0.15 + Pacing×0.20 + Trending×0.15 + CTA×0.15 + Rewatch×0.10) × 10
 */
export function calculateViralityScore(metrics: AnalysisMetrics): number {
    const weightedSum =
        metrics.hookStrength * METRIC_WEIGHTS.hookStrength +
        metrics.visualQuality * METRIC_WEIGHTS.visualQuality +
        metrics.pacing * METRIC_WEIGHTS.pacing +
        metrics.trendingElements * METRIC_WEIGHTS.trendingElements +
        metrics.engagementCTA * METRIC_WEIGHTS.engagementCTA +
        metrics.rewatchPotential * METRIC_WEIGHTS.rewatchPotential;

    // Multiply by 10 to get 1-100 scale
    return Math.round(weightedSum * 10);
}

export interface ReachEstimate {
    reach: string;         // display string, e.g. "2.2K-4.9K"
    engagement: string;    // display string, e.g. "3%-5.5%"
    reachMin?: number;     // numeric band — only set when follower-anchored
    reachMax?: number;
}

// Compact human count: 1234 -> "1.2K", 2_500_000 -> "2.5M"
function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${Math.round(n)}`;
}

/**
 * Estimate reach from the virality score. When the follower count is known
 * (Instagram reels), anchor the estimate to the account size — a realistic
 * fraction-of-followers band — instead of the account-blind absolute table.
 */
export function estimateReach(score: number, followers?: number): ReachEstimate {
    const engagement = (
        REACH_ESTIMATES.find(e => score >= e.min && score <= e.max)
        ?? REACH_ESTIMATES[REACH_ESTIMATES.length - 1]
    ).engagement;

    if (followers && followers > 0) {
        const band = FOLLOWER_REACH_BANDS.find(b => score >= b.min && score <= b.max)
            ?? FOLLOWER_REACH_BANDS[FOLLOWER_REACH_BANDS.length - 1];
        const reachMin = Math.round(followers * band.lo);
        const reachMax = Math.round(followers * band.hi);
        return { reach: `${formatCount(reachMin)}-${formatCount(reachMax)}`, engagement, reachMin, reachMax };
    }

    const absolute = REACH_ESTIMATES.find(e => score >= e.min && score <= e.max);
    return absolute
        ? { reach: absolute.reach, engagement: absolute.engagement }
        : { reach: '1K-10K', engagement: '0.5%-2%' };
}

/**
 * The verdict IS the comparison of actual reach against the estimate we display,
 * so the two can never contradict each other.
 */
export function deriveVerdict(actualReach: number, reachMin: number, reachMax: number): PerformanceVerdict {
    if (actualReach > reachMax) return 'overperformed';
    if (actualReach < reachMin) return 'underperformed';
    return 'as-expected';
}

/**
 * Get best posting time recommendation
 */
export function getBestPostTime(score: number): string {
    // Higher scores get prime time slots
    if (score >= 70) return BEST_POST_TIMES[0];
    if (score >= 40) return BEST_POST_TIMES[1];
    return BEST_POST_TIMES[2];
}

/**
 * Generate recommendations based on metrics
 */
export function generateRecommendations(metrics: AnalysisMetrics): LocalizedText[] {
    const recommendations: LocalizedText[] = [];

    // Hook strength recommendations
    if (metrics.hookStrength < 6) {
        recommendations.push(l(
            'Strengthen your opening hook - capture attention in the first 1-3 seconds',
            'قوِّ الجذب الافتتاحي — اخطف الانتباه في أول 1-3 ثوانٍ'
        ));
    } else if (metrics.hookStrength >= 8) {
        recommendations.push(l(
            'Your hook is excellent - viewers will stay for the opening',
            'جذبك ممتاز — سيبقى المشاهدون من البداية'
        ));
    }

    // Visual quality recommendations
    if (metrics.visualQuality < 6) {
        recommendations.push(l(
            'Improve visual quality - better lighting and stable framing',
            'حسّن الجودة البصرية — إضاءة أفضل وتأطير ثابت'
        ));
    } else if (metrics.visualQuality >= 8) {
        recommendations.push(l(
            'Visual composition is excellent - maintain this quality',
            'التكوين البصري ممتاز — حافظ على هذه الجودة'
        ));
    }

    // Pacing recommendations
    if (metrics.pacing < 6) {
        recommendations.push(l(
            'Speed up pacing with quicker cuts and scene changes',
            'سرّع الإيقاع بقطعات وتغييرات مشاهد أسرع'
        ));
    } else if (metrics.pacing >= 8) {
        recommendations.push(l(
            'Great pacing that keeps viewers engaged throughout',
            'إيقاع رائع يبقي المشاهدين متفاعلين طوال الوقت'
        ));
    }

    // Trending elements recommendations
    if (metrics.trendingElements < 6) {
        recommendations.push(l(
            'Consider adding trending audio for a 15-20% boost in reach',
            'فكر في إضافة صوت رائج لزيادة الوصول 15-20%'
        ));
        recommendations.push(l(
            'Use trending formats and effects from the Reels tab',
            'استخدم صيغًا ومؤثرات رائجة من تبويب الريلز'
        ));
    } else if (metrics.trendingElements >= 8) {
        recommendations.push(l(
            'Excellent use of trending elements - timing is key',
            'استخدام ممتاز لعناصر الترند — التوقيت هو المفتاح'
        ));
    }

    // CTA recommendations
    if (metrics.engagementCTA < 6) {
        recommendations.push(l(
            'Add a clear call-to-action - ask viewers to comment, save, or share',
            'أضف دعوة واضحة للتفاعل — اطلب تعليقًا أو حفظًا أو مشاركة'
        ));
        recommendations.push(l(
            'Include a question to encourage comments',
            'أدرج سؤالًا لتشجيع التعليقات'
        ));
    } else if (metrics.engagementCTA >= 8) {
        recommendations.push(l(
            'Strong CTA that encourages engagement',
            'دعوة قوية للتفاعل تشجع المشاركة'
        ));
    }

    // Rewatch potential recommendations
    if (metrics.rewatchPotential < 6) {
        recommendations.push(l(
            'Add a twist or reveal that makes viewers want to rewatch',
            'أضف مفاجأة أو كشفًا يدفع المشاهدين لإعادة المشاهدة'
        ));
    } else if (metrics.rewatchPotential >= 8) {
        recommendations.push(l(
            'High rewatch value - this content is shareable',
            'قيمة إعادة مشاهدة عالية — هذا المحتوى قابل للمشاركة'
        ));
    }

    // Always add posting time recommendation
    recommendations.push(l(
        'Best posting time: 7-10 PM for maximum reach',
        'أفضل وقت للنشر: 7-10 مساءً لأقصى وصول'
    ));

    return recommendations.slice(0, 8); // Cap at 8 recommendations
}

/**
 * Build complete analysis result from AI response
 */
export function buildAnalysisResult(
    metrics: AnalysisMetrics,
    aiResponse: {
        strengths?: LocalizedText[];
        improvements?: LocalizedText[];
        summary?: LocalizedText;
        recommendations?: LocalizedText[];
    },
    context: {
        provider: ProviderName;
        providerModel?: string;
        providerNote?: string;
        transcript?: string;
        technical?: TechnicalSignals;
        hook?: HookAnalysis;
        suggestedCaption?: LocalizedText;
        hashtags?: string[];
        metricAdvice?: MetricAdvice;
        actual?: ActualPerformance;
        performanceReview?: PerformanceReview;
        calibration?: CalibrationSummary;
    }
): AnalysisResult {
    const viralityScore = calculateViralityScore(metrics);
    const { reach, engagement, reachMin, reachMax } = estimateReach(viralityScore, context.actual?.followers);
    const bestPostTime = getBestPostTime(viralityScore);

    // Use AI recommendations if provided, otherwise generate our own
    const recommendations = aiResponse.recommendations?.length
        ? aiResponse.recommendations
        : generateRecommendations(metrics);

    const summary = aiResponse.summary && (aiResponse.summary.en || aiResponse.summary.ar)
        ? aiResponse.summary
        : l(
            `Your Reel scored ${viralityScore}/100 for viral potential.`,
            `حصل الريل على ${viralityScore}/100 في احتمالية الانتشار.`
        );

    // Anchor the verdict to the reach estimate we actually display, so the panel
    // can never say "overperformed" next to a prediction the reel fell short of.
    let performanceReview = context.performanceReview;
    if (performanceReview && context.actual && reachMin !== undefined && reachMax !== undefined) {
        performanceReview = {
            ...performanceReview,
            verdict: deriveVerdict(context.actual.reach, reachMin, reachMax)
        };
    }

    return {
        viralityScore,
        metrics,
        recommendations,
        estimatedReach: reach,
        engagementRate: engagement,
        bestPostTime,
        summary,
        strengths: aiResponse.strengths || [],
        improvements: aiResponse.improvements || [],
        ...context,
        performanceReview
    };
}
