// Does the AI's read of the CONTENT predict anything, once it can actually
// perceive the content?
//
// Leave-one-out: for each labelled reel, show the model every OTHER reel of this
// account with its real outcome, then ask where this one will land. The reel
// never appears in its own examples, so this measures prediction, not recall.
// Scored with the same date-controlled partial Spearman the calibration uses.
//
//   node scripts/learn-eval.mjs                     signals + frames + history
//   MODE=content node scripts/learn-eval.mjs        content only (isolates perception)
//   TARGET=shares node scripts/learn-eval.mjs       predict shares instead of reach
//   PROVIDER=gemini node scripts/learn-eval.mjs     use Gemini instead of OPEN_MODEL_*
//
// Transcripts are cached in data/transcripts.json — for spoken content they are
// the channel that matters, and a vision-only test is a strawman without them.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FFMPEG = process.env.FFMPEG_PATH
    || 'ffmpeg';
const CACHE = 'public/ig-cache';
const TRANSCRIPTS = 'data/transcripts.json';
const FRAMES = 8;

const fileEnv = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^#?\s*([A-Z_]+)=(.*)$/);
    if (m && !fileEnv[m[1]]) fileEnv[m[1]] = m[2].trim();
}
const env = { ...fileEnv, ...process.env };

const CONTENT_ONLY = env.MODE === 'content';
const TARGET = env.TARGET === 'shares' ? 'shares' : 'reach';
const USE_GEMINI = env.PROVIDER === 'gemini';

// Gemini speaks the OpenAI shape at this path, so one code path serves both
const BASE = USE_GEMINI ? 'https://generativelanguage.googleapis.com/v1beta/openai' : env.OPEN_MODEL_BASE_URL;
const KEY = USE_GEMINI ? env.GEMINI_API_KEY : env.OPEN_MODEL_API_KEY;
const MODEL = USE_GEMINI ? (env.GEMINI_MODEL || 'gemini-2.5-flash') : env.OPEN_MODEL_ID;
const OUT = `data/learn-eval-${USE_GEMINI ? 'gemini' : 'open'}-${CONTENT_ONLY ? 'content' : 'signals'}-${TARGET}.json`;

const cal = await import(pathToFileURL(path.resolve('src/lib/calibration.ts')).href);
const records = JSON.parse(readFileSync('data/analyses.json', 'utf8'));
const profile = JSON.parse(readFileSync(`${CACHE}/profile.json`, 'utf8'));
const reels = cal.buildLabelledReels(records);
const sharesOf = new Map(records.filter(r => r.mediaId && r.outcome).map(r => [r.mediaId, r.outcome.shares]));
for (const r of reels) r.shares = sharesOf.get(r.mediaId) ?? 0;

const fileIdOf = new Map(profile.reels.map(r => [r.mediaId, r.fileId]));
const captionOf = new Map(profile.reels.map(r => [r.mediaId, (r.caption || '').replace(/\s+/g, ' ').slice(0, 80)]));

const outcome = r => (TARGET === 'shares' ? r.shares : r.reach);
const sig = r => `${Math.round(r.signals.duration)}s, ${Number(r.signals.cutsPerMinute).toFixed(1)} cuts/min, `
    + `avg shot ${Number(r.signals.avgShotSeconds).toFixed(1)}s, `
    + `${r.signals.loudnessLufs === null ? 'no audio' : `${r.signals.loudnessLufs} LUFS`}`;

// ---- transcripts (Groq whisper, free) -------------------------------------
const transcripts = existsSync(TRANSCRIPTS) ? JSON.parse(readFileSync(TRANSCRIPTS, 'utf8')) : {};

async function transcribe(mediaId) {
    if (transcripts[mediaId] !== undefined) return transcripts[mediaId];
    const video = path.join(CACHE, `${fileIdOf.get(mediaId)}.mp4`);
    let text = '';
    try {
        const audio = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', video,
            '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-f', 'mp3', 'pipe:1'],
            { maxBuffer: 64 * 1024 * 1024 });
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'a.mp3');
        form.append('model', env.WHISPER_MODEL || 'whisper-large-v3');
        form.append('response_format', 'json');
        const res = await fetch(`${(env.WHISPER_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')}/audio/transcriptions`, {
            method: 'POST', headers: { Authorization: `Bearer ${env.WHISPER_API_KEY}` }, body: form,
            signal: AbortSignal.timeout(90000)
        });
        if (res.ok) text = ((await res.json()).text || '').trim();
        else console.log(`  transcript HTTP ${res.status} for ${mediaId}`);
    } catch (error) {
        console.log(`  transcript failed for ${mediaId}: ${String(error).slice(0, 80)}`);
    }
    // Never cache a failure: a rate-limited blank would otherwise become permanent
    if (text) {
        transcripts[mediaId] = text;
        writeFileSync(TRANSCRIPTS, JSON.stringify(transcripts, null, 2));
    }
    return text;
}

function framesFor(mediaId) {
    const video = path.join(CACHE, `${fileIdOf.get(mediaId)}.mp4`);
    const out = [];
    for (let i = 0; i < FRAMES; i++) {
        try {
            const buf = execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(1 + i * 3), '-i', video,
                '-frames:v', '1', '-vf', 'scale=-2:384,format=yuvj420p', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', '-'],
                { maxBuffer: 64 * 1024 * 1024 });
            if (buf.length) out.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
        } catch { /* past the end of the video */ }
    }
    return out;
}

async function predict(target, others) {
    const ranked = [...others].sort((a, b) => outcome(b) - outcome(a));
    const step = Math.max(1, Math.floor(ranked.length / 16));
    const shown = ranked.filter((_, i) => i % step === 0).slice(0, 16);

    const table = shown.map(r => {
        const said = (transcripts[r.mediaId] || '').replace(/\s+/g, ' ').slice(0, 160);
        return `- ${r.postedAt.slice(0, 10)} | ${CONTENT_ONLY ? '' : sig(r) + ' | '}${TARGET.toUpperCase()} ${outcome(r)}`
            + `${captionOf.get(r.mediaId) ? ` | caption: "${captionOf.get(r.mediaId)}"` : ''}`
            + `${said ? ` | says: "${said}..."` : ''}`;
    }).join('\n');

    const said = (await transcribe(target.mediaId)).replace(/\s+/g, ' ').slice(0, 1500);
    const prompt = `You are predicting how far one specific Instagram creator's reel will travel.
Account: @${profile.username}, ${profile.followers} followers, Arabic educational content
(religion, technology, everyday knowledge). Their ${TARGET} ranges from almost nothing
to their best reel by a factor of thousands.

THEIR PAST REELS, with what each one actually got:
${table}

Work out what separates the ones that travelled from the ones that did not. Topic,
angle, who it is for, whether a viewer would forward it to someone else.

THE REEL TO PREDICT${CONTENT_ONLY ? '' : ` — measured: ${sig(target)}`}
${said ? `What is said in it: "${said}"` : 'No speech could be transcribed.'}
${FRAMES} frames from it are attached below.

Answer with EXACTLY ONE JSON object and nothing else:
{"percentile": 0-100}
0 = among this creator's worst for ${TARGET}, 50 = typical, 100 = their very best.`;

    const content = [{ type: 'text', text: prompt }];
    for (const [i, f] of framesFor(target.mediaId).entries()) {
        content.push({ type: 'text', text: `Frame ${i + 1}` });
        content.push({ type: 'image_url', image_url: { url: f } });
    }

    const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: MODEL, max_tokens: 800, temperature: 0.2, messages: [{ role: 'user', content }] }),
        signal: AbortSignal.timeout(180000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    const text = (await res.json()).choices?.[0]?.message?.content ?? '';
    const match = text.replace(/```json|```/g, '').match(/\{[\s\S]*?\}/);
    if (!match) throw new Error(`no JSON: ${text.slice(0, 90)}`);
    const value = Number(JSON.parse(match[0]).percentile);
    if (!Number.isFinite(value)) throw new Error('percentile not a number');
    return value;
}

console.log(`${MODEL} · ${CONTENT_ONLY ? 'content only' : 'signals + content'} · predicting ${TARGET} · n=${reels.length}\n`);

// Transcribe everything up front so the examples can quote it too
let missing = reels.filter(r => transcripts[r.mediaId] === undefined).length;
if (missing) {
    console.log(`transcribing ${missing} reels...`);
    for (const r of reels) await transcribe(r.mediaId);
    console.log('transcripts ready\n');
}

const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
let i = 0;
for (const target of reels) {
    i++;
    if (done[target.mediaId] !== undefined) continue;
    try {
        const value = await predict(target, reels.filter(r => r.mediaId !== target.mediaId));
        done[target.mediaId] = value;
        writeFileSync(OUT, JSON.stringify(done, null, 2));
        console.log(`[${String(i).padStart(2)}/${reels.length}] predicted ${String(value).padStart(3)} · actual ${TARGET} ${String(outcome(target)).padStart(7)}`);
    } catch (error) {
        console.log(`[${String(i).padStart(2)}/${reels.length}] FAILED ${String(error).slice(0, 120)}`);
    }
}

const scored = reels.filter(r => done[r.mediaId] !== undefined);
const y = scored.map(r => Math.log10(Math.max(outcome(r), 1)));
const z = scored.map(r => new Date(r.postedAt).getTime());
const WEIGHTS = { hookStrength: 0.25, visualQuality: 0.15, pacing: 0.20, trendingElements: 0.15, engagementCTA: 0.15, rewatchPotential: 0.10 };
const line = (label, x) => {
    const rho = cal.partialSpearman(x, y, z);
    const p = cal.partialPermutationP(x, y, z, 5000, 11);
    console.log(`  ${label.padEnd(32)} rho ${rho.toFixed(3).padStart(6)}   p ${p.toFixed(4)}`);
};
console.log(`\n=== LEAVE-ONE-OUT (n=${scored.length}, target ${TARGET}, date-controlled) ===`);
line(`AI: ${MODEL}`, scored.map(r => done[r.mediaId]));
line('cutsPerMinute (baseline)', scored.map(r => r.signals.cutsPerMinute));
line('current rubric score', scored.map(r => cal.weightedScore(r.metrics, WEIGHTS)));
