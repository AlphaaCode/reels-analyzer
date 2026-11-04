'use client';

// Lightweight bilingual (English / Arabic) UI layer: context + string tables.
// Arabic flips the document to RTL; the analyze API receives the language so
// Gemini writes the report in the same language.

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { LocalizedText } from '@/types/analysis';

export type Lang = 'en' | 'ar';

const EN = {
    tagline: 'AI-Powered Virality Score',
    badge: 'Gemini free tier + ffmpeg',
    heroTitle: 'Will Your Reel Go Viral?',
    heroSub: 'Upload your video and get an AI-powered prediction score in seconds. Analyze hooks, pacing, visuals, and trending factors.',
    footer: '© 2026 Reels Analyzer — Built for Creators.',

    uploadDrop: 'Drop your Reel here',
    uploadUploading: 'Uploading...',
    uploadOr: 'or',
    uploadBrowse: 'browse',
    uploadBrowseSuffix: 'to select a file',
    chipMax: 'Max 1GB',
    chipOptimal: '15-90s optimal',

    labelDuration: 'Duration',
    labelSize: 'Size',
    labelFormat: 'Format',
    labelRatio: 'Ratio',
    btnRemove: 'Remove',
    btnAnalyze: 'Analyze Virality',
    btnAnalyzing: 'Analyzing...',

    loadingNote: 'This usually takes 2-3 minutes',

    // Pipeline stages, in the order the server reports them
    stageSignals: 'Measuring signals with ffmpeg',
    stageThumbs: 'Extracting hook thumbnails',
    stageFrames: 'Sampling frames for the AI',
    stageTranscript: 'Transcribing the speech',
    stageAI: 'AI is analyzing your reel',
    stageScore: 'Scoring virality metrics',

    summaryTitle: 'Summary',
    trackTitle: 'Track record',
    trackSub: 'What this app has measured about its own accuracy on your account.',
    trackScoreVsReach: 'Score vs your reach',
    trackRecency: 'Reach vs post date',
    trackNoise: 'Model noise, same video',
    trackInstrument: 'Scored by',
    trackPredictors: 'What tracks your reach',
    trackHolds: 'holds up',
    trackPredictorsNote: 'Correlation with reach after controlling for post date, corrected for testing eleven predictors at once. Only the marked ones survive that correction.',

    predClassLow: 'Below your average',
    predClassMid: 'A typical reel for you',
    predClassHigh: 'Your strongest band',
    predExpect: 'Expect {low} - {high} reach, typically around {median}.',
    predBreakoutOdds: '{hits} of your {count} reels in this band broke out (past {threshold} reach).',
    predExpectedHere: 'where reels like this land',
    predFixTitle: 'Fix this first',
    predFixBody: 'This reel has {yours} {signal}. Your reels above {target} reach {theirMedian} typically, against {yourMedian} here - and {hits} of those {count} broke out.',
    predAlreadyBest: 'Editing is already in your strongest band ({yours} {signal}). Nothing measured is holding this one back.',
    predBasis: 'Based on {signal}, the one signal that tracks reach on your account (rho {rho}) across {n} published reels. Your AI score is a craft read and does not predict reach - see the track record.',

    predTitle: 'Verdict',
    predBadgeLocked: 'not calibrated',
    predBadgeCalibrated: 'calibrated',
    predBadgeAlarm: 'score is inverted',
    predScoredAt: 'scored {score}/100',
    predHistoryOnly: 'What your published reels did — not a forecast for this one:',
    predYourPlace: 'Where this reel is expected to land among yours:',
    predSummary: '{n} mature reels · {breakouts} broke out (past {threshold} reach)',
    predLockedGeneric: 'Not enough evidence to forecast this reel yet.',
    predLockedWhy: 'Below that bar any number here would be noise wearing a decimal point.',
    predStrongest: 'What does predict your reach:',
    predStrongestBody: '{signal} (rho {rho}) — measured locally, and the only thing in your data that tracks reach.',
    predNoHistory: 'Analyze a reel from My Instagram to start building the baseline this needs.',

    statReach: 'Est. Reach',
    statEngagement: 'Est. Engagement',
    statPostTime: 'Best Post Time',
    nextSteps: 'Your Next Steps',
    btnDownload: 'Download Report',
    btnAnother: 'Analyze Another Reel',
    proTipTitle: 'Pro Tip:',
    proTipBody: 'Re-edit your video based on these recommendations and re-analyze to see your score improve!',

    hookTitle: 'Hook — the first 3 seconds',
    hookSub: 'Most viewers decide to stay or scroll right here.',
    hookCutsSuffix: 'visual cut(s) measured in the hook window',

    captionTitle: 'Caption idea',
    captionEmpty: 'Caption & hashtag ideas appear here once a free Gemini key is configured.',
    btnCopy: 'Copy caption + hashtags',
    btnCopied: 'Copied! ✓',

    technicalTitle: 'Measured signals — ffmpeg, local & free',
    transcriptTitle: 'Transcript',
    expandHint: 'click to expand',

    recsTitle: 'AI Recommendations',
    recsSub: 'Actionable tips to increase viral potential',
    recsEmpty: 'No specific recommendations generated.',

    providerGemini: 'Analyzed by our backup AI — a bit slower',
    providerOpen: 'Analyzed by our premium AI',
    providerHeuristic: 'Quick estimate — measured signals only',

    techResolution: 'Resolution',
    techAspect: 'Aspect ratio',
    techFps: 'Frame rate',
    techLoudness: 'Loudness',
    techPacing: 'Pacing',
    techDuration: 'Duration',
    hintResolution: 'target 1080×1920',
    hintAspect: 'target 9:16 vertical',
    hintFps: 'target ≥30 fps',
    hintLoudness: 'target ≈ -14 LUFS',
    hintPacing: 'more cuts tracks more reach',
    hintDuration: 'optimal 15–90s',
    techNoAudio: 'no audio',
    techUnknown: 'unknown',
    wordCuts: 'cuts',
    wordAvgShot: 'avg shot',
    wordSilences: 'silence span(s) ≥1s',

    modalForVideoAI: 'For this video (AI)',
    modalForVideoMeasured: 'For this video (measured)',
    modalPlaybook: 'Playbook',
    modalGotIt: 'Got it',
    cardClickHint: 'Click for how to improve',

    levelVeryHigh: 'Very High',
    levelHigh: 'High',
    levelMedium: 'Medium',
    levelLow: 'Low',
    levelVeryLow: 'Very Low',
    viralPotentialTpl: '{level} Viral Potential',

    igTitle: 'My Instagram',
    igFollowers: 'followers',
    igPosts: 'posts',
    igViews: 'views',
    igAnalyze: 'Analyze',
    igCachedNote: 'Your connected account — real lifetime stats per reel, videos cached locally.',

    rcTitle: 'Reality Check',
    rcVerdictOver: 'Overperformed',
    rcVerdictExpected: 'As expected',
    rcVerdictUnder: 'Underperformed',
    rcActual: 'Actual performance',
    rcPredicted: 'Predicted reach',
    rcAppScore: 'App score',
    rcReach: 'reach',
    rcInteractions: 'interactions',
    rcWhy: 'Why it happened',
    rcNext: 'What to do next'
};

export type StringKey = keyof typeof EN;

const AR: Record<StringKey, string> = {
    tagline: 'تقييم الانتشار بالذكاء الاصطناعي',
    badge: 'Gemini المجاني + ffmpeg',
    heroTitle: 'هل سينتشر الريل الخاص بك؟',
    heroSub: 'ارفع الفيديو واحصل على درجة انتشار متوقعة خلال ثوانٍ — تحليل الجذب والإيقاع والجودة البصرية وعناصر الترند.',
    footer: '© 2026 Reels Analyzer — صُنع للمبدعين.',

    uploadDrop: 'أسقط الريل هنا',
    uploadUploading: 'جارٍ الرفع...',
    uploadOr: 'أو',
    uploadBrowse: 'تصفّح',
    uploadBrowseSuffix: 'لاختيار ملف',
    chipMax: 'حتى 1GB',
    chipOptimal: 'الأمثل 15-90 ثانية',

    labelDuration: 'المدة',
    labelSize: 'الحجم',
    labelFormat: 'الصيغة',
    labelRatio: 'الأبعاد',
    btnRemove: 'إزالة',
    btnAnalyze: 'حلّل الانتشار',
    btnAnalyzing: 'جارٍ التحليل...',

    loadingNote: 'يستغرق عادةً من دقيقتين إلى ثلاث',

    stageSignals: 'قياس الإشارات عبر ffmpeg',
    stageThumbs: 'استخراج صور الجذب',
    stageFrames: 'أخذ عينات من الإطارات للذكاء الاصطناعي',
    stageTranscript: 'تفريغ الكلام إلى نص',
    stageAI: 'الذكاء الاصطناعي يحلّل الريل',
    stageScore: 'حساب مقاييس الانتشار',

    summaryTitle: 'الخلاصة',
    trackTitle: 'سجل الأداء',
    trackSub: 'ما قاسه التطبيق عن دقته هو نفسه على حسابك.',
    trackScoreVsReach: 'التقييم مقابل وصولك',
    trackRecency: 'الوصول مقابل تاريخ النشر',
    trackNoise: 'تشتت النموذج على نفس الفيديو',
    trackInstrument: 'قُيّم بواسطة',
    trackPredictors: 'ما يرتبط بوصولك',
    trackHolds: 'صامد',
    trackPredictorsNote: 'الارتباط بالوصول بعد ضبط تاريخ النشر، ومصحّح لاختبار أحد عشر مؤشرًا معًا. المؤشرات المعلَّمة فقط هي التي صمدت.',

    predClassLow: 'دون متوسطك',
    predClassMid: 'ريل عادي بمقاييسك',
    predClassHigh: 'أقوى فئاتك',
    predExpect: 'توقع وصولًا بين {low} و{high}، وغالبًا حوالي {median}.',
    predBreakoutOdds: '{hits} من {count} ريل في هذه الفئة حقق انتشارًا (تجاوز {threshold} وصول).',
    predExpectedHere: 'هنا تقع الريلز المشابهة',
    predFixTitle: 'أصلح هذا أولًا',
    predFixBody: 'هذا الريل فيه {yours} {signal}. ريلزك التي تتجاوز {target} تصل عادةً إلى {theirMedian} مقابل {yourMedian} هنا، و{hits} من {count} منها حققت انتشارًا.',
    predAlreadyBest: 'المونتاج في أقوى فئاتك أصلًا ({yours} {signal}). لا شيء مقاس يعيق هذا الريل.',
    predBasis: 'بناءً على {signal}، وهو المؤشر الوحيد المرتبط بالوصول في حسابك (rho {rho}) عبر {n} ريل منشور. تقييم الذكاء الاصطناعي قراءة للحرفة ولا يتنبأ بالوصول — راجع سجل الأداء.',

    predTitle: 'الحكم',
    predBadgeLocked: 'غير معاير',
    predBadgeCalibrated: 'معاير',
    predBadgeAlarm: 'التقييم معكوس',
    predScoredAt: 'التقييم {score}/100',
    predHistoryOnly: 'ما حققته ريلزك المنشورة — وليس توقعًا لهذا الريل:',
    predYourPlace: 'أين يُتوقع أن يقع هذا الريل بين ريلزك:',
    predSummary: '{n} ريل ناضج · {breakouts} حقق انتشارًا (تجاوز {threshold} وصول)',
    predLockedGeneric: 'لا توجد أدلة كافية للتنبؤ بهذا الريل بعد.',
    predLockedWhy: 'دون هذا الحد يكون أي رقم هنا مجرد ضجيج.',
    predStrongest: 'ما يتنبأ فعلًا بوصولك:',
    predStrongestBody: '{signal} (rho {rho}) — مقاس محليًا، وهو الشيء الوحيد في بياناتك المرتبط بالوصول.',
    predNoHistory: 'حلّل ريلًا من قسم حسابي لبناء الأساس المطلوب.',

    statReach: 'الوصول المتوقع',
    statEngagement: 'التفاعل المتوقع',
    statPostTime: 'أفضل وقت للنشر',
    nextSteps: 'خطواتك التالية',
    btnDownload: 'تحميل التقرير',
    btnAnother: 'تحليل ريل آخر',
    proTipTitle: 'نصيحة:',
    proTipBody: 'عدّل الفيديو وفق هذه التوصيات ثم أعد التحليل لترى الدرجة ترتفع!',

    hookTitle: 'الجذب — أول 3 ثوانٍ',
    hookSub: 'هنا يقرر معظم المشاهدين البقاء أو التمرير.',
    hookCutsSuffix: 'قطعة بصرية مرصودة في نافذة الجذب',

    captionTitle: 'اقتراح الكابشن',
    captionEmpty: 'تظهر اقتراحات الكابشن والهاشتاقات هنا بعد إضافة مفتاح Gemini المجاني.',
    btnCopy: 'نسخ الكابشن + الهاشتاقات',
    btnCopied: 'تم النسخ! ✓',

    technicalTitle: 'الإشارات المقاسة — ffmpeg محليًا ومجانًا',
    transcriptTitle: 'النص الكامل',
    expandHint: 'اضغط للعرض',

    recsTitle: 'توصيات الذكاء الاصطناعي',
    recsSub: 'نصائح عملية لرفع احتمالية الانتشار',
    recsEmpty: 'لا توجد توصيات محددة.',

    providerGemini: 'تم التحليل بالنموذج الاحتياطي — أبطأ قليلًا',
    providerOpen: 'تم التحليل بالذكاء الاصطناعي المتقدم',
    providerHeuristic: 'تقدير سريع — بالإشارات المقاسة فقط',

    techResolution: 'الدقة',
    techAspect: 'نسبة الأبعاد',
    techFps: 'معدل الإطارات',
    techLoudness: 'مستوى الصوت',
    techPacing: 'الإيقاع',
    techDuration: 'المدة',
    hintResolution: 'الهدف 1080×1920',
    hintAspect: 'الهدف 9:16 عمودي',
    hintFps: 'الهدف 30+ إطار/ث',
    hintLoudness: 'الهدف ≈ ‎-14 LUFS',
    hintPacing: 'كثرة القطعات ترتبط بوصول أعلى',
    hintDuration: 'الأمثل 15–90 ث',
    techNoAudio: 'بدون صوت',
    techUnknown: 'غير معروف',
    wordCuts: 'قطعة',
    wordAvgShot: 'متوسط اللقطة',
    wordSilences: 'فترة صمت ≥1ث',

    modalForVideoAI: 'لهذا الفيديو تحديدًا (ذكاء اصطناعي)',
    modalForVideoMeasured: 'لهذا الفيديو (قياسات محلية)',
    modalPlaybook: 'قواعد عامة',
    modalGotIt: 'فهمت',
    cardClickHint: 'اضغط لمعرفة كيف تحسّنها',

    levelVeryHigh: 'مرتفعة جدًا',
    levelHigh: 'مرتفعة',
    levelMedium: 'متوسطة',
    levelLow: 'منخفضة',
    levelVeryLow: 'منخفضة جدًا',
    viralPotentialTpl: 'احتمالية الانتشار: {level}',

    igTitle: 'حسابي على إنستغرام',
    igFollowers: 'متابع',
    igPosts: 'منشور',
    igViews: 'مشاهدة',
    igAnalyze: 'حلّل',
    igCachedNote: 'حسابك المتصل — إحصائيات حقيقية لكل ريل، والفيديوهات مخزّنة محليًا.',

    rcTitle: 'مقارنة بالواقع',
    rcVerdictOver: 'أداء فوق المتوقع',
    rcVerdictExpected: 'ضمن المتوقع',
    rcVerdictUnder: 'أداء دون المتوقع',
    rcActual: 'الأداء الفعلي',
    rcPredicted: 'الوصول المتوقع',
    rcAppScore: 'تقييم التطبيق',
    rcReach: 'وصول',
    rcInteractions: 'تفاعل',
    rcWhy: 'لماذا حدث ذلك',
    rcNext: 'الخطوة التالية'
};

const STRINGS: Record<Lang, Record<StringKey, string>> = { en: EN, ar: AR };

interface LangContextValue {
    lang: Lang;
    setLang: (lang: Lang) => void;
    t: (key: StringKey) => string;
}

const LangContext = createContext<LangContextValue>({
    lang: 'en',
    setLang: () => {},
    t: key => EN[key]
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [lang, setLangState] = useState<Lang>(() => {
        if (typeof window === 'undefined') return 'en';
        const saved = window.localStorage.getItem('lang');
        return saved === 'ar' || saved === 'en' ? saved : 'en';
    });

    useEffect(() => {
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    }, [lang]);

    const setLang = (next: Lang) => {
        setLangState(next);
        window.localStorage.setItem('lang', next);
    };

    const t = (key: StringKey) => STRINGS[lang][key] ?? EN[key];

    return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
    return useContext(LangContext);
}

// Pick the current language's half of an AI-written text, falling back sanely
export function pickText(text: LocalizedText | undefined, lang: Lang): string {
    if (!text) return '';
    return text[lang] || text.en || text.ar || '';
}
