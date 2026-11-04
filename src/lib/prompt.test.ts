// Run with: npm test
// The scores-only prompt is the calibration instrument: the labelled history
// was scored with exactly this text. If the pin below fails, the change makes
// new scores incomparable with that history. Treat it as a new instrument,
// don't just update the expected text.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRepairPrompt, renderReportPrompt, renderScorePrompt, type StatsData } from './prompt.ts';

const SCORES_PROMPT = `You are an expert short-form video strategist analyzing an Instagram Reel for viral potential.

<media>

MEASURED SIGNALS (computed locally with ffmpeg — treat these numbers as ground truth):
<signals>

Score these six aspects from 1 to 10:
1. hookStrength — do the first 3 seconds grab attention, visually AND in speech/on-screen text?
2. visualQuality — composition, lighting, framing, editing polish.
3. pacing — retention rhythm; combine the measured cut data with how the content actually flows.
4. trendingElements — trending sounds, formats, effects, cultural relevance.
5. engagementCTA — explicit or implicit prompts to comment, save, share, or follow.
6. rewatchPotential — loopability, novelty, entertainment or information density.

CALIBRATION — be strict and consistent:
- 5 = the median Instagram reel; most videos land at 4-6 on most metrics.
- 7 = clearly above average with visible craft.
- 8 = would stand out in a niche feed — only award with concrete evidence.
- 9-10 = top-1% execution; cite the exact moment that earns it.
- 1-3 = actively hurts retention (broken audio, unreadable text, aimless pacing).
Score each metric independently — one strong metric must not lift the others.
Cross-check against the measured signals: the pacing score must be consistent with the measured cuts/min and silence data, and hookStrength must match the measured first-3s cuts AND what is actually said or shown.`;

const SCORES_JSON_LINE = `Respond with EXACTLY ONE JSON object and nothing else, no markdown fences, no commentary:
{"hookStrength": 1-10, "visualQuality": 1-10, "pacing": 1-10, "trendingElements": 1-10, "engagementCTA": 1-10, "rewatchPotential": 1-10}`;

const data = { media: '<media>', signals: '<signals>' };
const stats: StatsData = {
    followers: '12,400', postedAt: '2026-10-01', views: '5000', reach: '4100',
    likes: '320', comments: '18', saved: '25', shares: '61'
};

test('the scores-only prompt is byte for byte the calibrated instrument', () => {
    assert.equal(renderScorePrompt(data, true), `${SCORES_PROMPT}\n\n${SCORES_JSON_LINE}`);
    // Gemini enforces the shape with a response schema, so it never got the JSON line
    assert.equal(renderScorePrompt(data, false), SCORES_PROMPT);
});

test('the full report prompt fills every placeholder, with and without real stats', () => {
    const plain = renderReportPrompt(data);
    const reviewed = renderReportPrompt({ ...data, actual: stats });
    for (const prompt of [plain, reviewed]) {
        assert.doesNotMatch(prompt, /\{\{|\}\}|<!--|^## /m);
        assert.ok(prompt.startsWith('You are an expert'), 'the role comes first');
        assert.ok(prompt.includes('<media>') && prompt.includes('<signals>'));
        assert.match(prompt, /OUTPUT FORMAT/);
    }
    assert.doesNotMatch(plain, /ACTUAL PERFORMANCE|performanceReview/, 'no review is asked for without stats');
    assert.match(reviewed, /the account has 12,400 followers; posted 2026-10-01/);
    assert.match(reviewed, /- 5000 views · 4100 unique reach · 320 likes · 18 comments · 25 saves · 61 shares/);
    assert.match(reviewed, /"performanceReview"/);
});

test('the repair prompt carries the errors and the keys to send back', () => {
    const prompt = renderRepairPrompt('- /recommendations: must have exactly 6 items, got 5', ['recommendations', 'summary']);
    assert.match(prompt, /- \/recommendations: must have exactly 6 items, got 5/);
    assert.match(prompt, /ONLY these keys, each corrected and complete: recommendations, summary\./);
});
