// Label the cached Instagram reels for the calibration engine.
//
//   npm run dev -- -p 3210      (in another terminal)
//   node scripts/backfill.mjs   (optionally: node scripts/backfill.mjs 3210)
//
// Analyses every cached reel that has no AI-scored row in data/analyses.json
// yet, one at a time, and appends its result via the normal analyze pipeline.
// Resumable: re-running picks up exactly where it stopped.
//
// The free Gemini tier allows roughly 16 video analyses per day. When the
// provider falls back to the heuristic engine, that is the quota talking —
// heuristic rows are excluded from calibration anyway, so the run stops rather
// than filling the history with rows the backtest cannot use. Run it again
// tomorrow to continue.

import { readFileSync, existsSync } from 'node:fs';

const ALL = process.argv.includes('--all');       // re-label everything, e.g. after switching model
const SCORES = process.argv.includes('--scores'); // six scores only: works on endpoints that cannot emit the full report
const PORT = process.argv.find(a => /^[0-9]+$/.test(a)) || '3210';
const BASE = `http://localhost:${PORT}`;
const PROFILE = 'public/ig-cache/profile.json';
const HISTORY = 'data/analyses.json';

const profile = JSON.parse(readFileSync(PROFILE, 'utf8'));
const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, 'utf8')) : [];

// A reel is done when it has a row from a real AI provider in the mode we are
// running: scores and full-report rows are different instruments, so a reel
// labelled one way still needs labelling the other way.
const wantedMode = SCORES ? 'scores' : 'full';
const scored = new Set(
    history
        .filter(record => record.provider !== 'heuristic' && record.mediaId && (record.mode ?? 'full') === wantedMode)
        .map(record => record.mediaId)
);
const pending = ALL ? profile.reels : profile.reels.filter(reel => !scored.has(reel.mediaId));

console.log(`${profile.reels.length} cached reels · ${scored.size} already scored · ${pending.length} to go\n`);
if (pending.length === 0) process.exit(0);

async function analyse(reel) {
    const actual = {
        views: reel.stats.views,
        reach: reel.stats.reach,
        likes: reel.stats.likes,
        comments: reel.stats.comments,
        saved: reel.stats.saved,
        shares: reel.stats.shares,
        followers: profile.followers,
        postedAt: reel.timestamp
    };
    const start = await fetch(`${BASE}/api/analyze/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: reel.fileId, actual, scoresOnly: SCORES })
    }).then(response => response.json());
    if (!start.jobId) throw new Error(JSON.stringify(start).slice(0, 200));

    const deadline = Date.now() + 8 * 60 * 1000;
    for (;;) {
        if (Date.now() > deadline) throw new Error('timed out after 8 minutes');
        await new Promise(resolve => setTimeout(resolve, 3000));
        const status = await fetch(`${BASE}/api/analyze/status?job=${start.jobId}`).then(response => response.json());
        if (status.status === 'done') return status.data;
        if (status.status === 'error') throw new Error(status.error || 'analysis failed');
    }
}

let done = 0;
let stopped = false;
for (const reel of pending) {
    const label = `[${String(++done).padStart(2)}/${pending.length}] ${reel.timestamp.slice(0, 10)}`;
    const startedAt = Date.now();
    try {
        const result = await analyse(reel);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`${label} score ${String(result.viralityScore).padStart(3)} · reach ${String(reel.stats.reach).padStart(7)} · ${result.provider} · ${seconds}s`);
        if (result.provider === 'heuristic') {
            console.log('\nProvider fell back to the heuristic engine — almost certainly the daily');
            console.log('AI quota. Stopping here; run this again tomorrow to continue.');
            stopped = true;
            break;
        }
    } catch (error) {
        console.log(`${label} FAILED — ${String(error).slice(0, 160)}`);
    }
}

if (!stopped) console.log('\nAll cached reels are labelled.');
