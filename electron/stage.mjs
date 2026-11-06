// Stage what the desktop app ships beside the ffmpeg that fetch-ffmpeg.mjs
// staged: the Next.js server from `npm run build`, the read-only files it
// loads from its own folder, and the files an edit job copies. Everything is
// copied from an explicit list, because a working copy also holds data/,
// uploads, the Instagram cache and .env.local, and the build's standalone
// folder can trace all of them in. Then it refuses if anything private came
// along anyway.
//
//   npm run build && node electron/stage.mjs

import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_CHECKER, JOB_SKILL } from '../src/lib/edit/prepare.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const standalone = path.join(root, '.next', 'standalone');
const stage = path.join(here, 'stage');
const server = path.join(stage, 'server');

if (!existsSync(path.join(standalone, 'server.js'))) throw new Error('No .next/standalone/server.js: run `npm run build` first');
if (!existsSync(path.join(stage, 'ffmpeg', 'ffmpeg.exe'))) throw new Error('No staged ffmpeg: run `node electron/fetch-ffmpeg.mjs` first');

rmSync(server, { recursive: true, force: true });
const copy = (from, to, filter) => cpSync(from, path.join(server, to), { recursive: true, filter });

// The build: the server, the packages it traced, its compiled output (not the trace lists) and the browser assets
for (const name of ['server.js', 'package.json', 'node_modules']) copy(path.join(standalone, name), name);
copy(path.join(standalone, '.next'), '.next', file => !file.endsWith('.nft.json'));
copy(path.join(root, '.next', 'static'), path.join('.next', 'static'));

// Read-only files the server loads: public's own files (its folders are user data), prompts, schema, fonts, the settings template
for (const name of readdirSync(path.join(root, 'public'))) {
    if (statSync(path.join(root, 'public', name)).isFile()) copy(path.join(root, 'public', name), path.join('public', name));
}
for (const dir of ['prompts', 'schema', path.join('assets', 'fonts')]) copy(path.join(root, dir), dir);
copy(path.join(root, '.env.example'), '.env.example');

// What an edit job copies, and the source its checker runs (Node strips the types)
for (const file of [JOB_CHECKER, JOB_SKILL]) copy(path.join(root, file), file);
copy(path.join(root, 'src', 'lib'), path.join('src', 'lib'), file => !file.endsWith('.test.ts'));

cpSync(path.join(here, 'server-host.js'), path.join(stage, 'server-host.js'));
cpSync(path.join(root, 'LICENSE'), path.join(stage, 'licenses', 'reels-analyzer', 'LICENSE.txt'));

// Nothing private: no settings file but the template, no user data folder, no key-shaped string in what was built or copied
const PRIVATE_DIRS = ['data', 'exports', path.join('public', 'uploads'), path.join('public', 'ig-cache')].map(dir => path.join('server', dir));
const TEXT = /\.(?:c?js|mjs|json|html|css|rsc|meta|body|txt|md|tsx?|example)$/;
const KEY = /AIza[0-9A-Za-z_-]{35}|gsk_[0-9A-Za-z]{20,}|nvapi-[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|hf_[0-9A-Za-z]{30,}|APP_PASSWORD=\S/;
const problems = [];
let bytes = 0;
let files = 0;
for (const rel of readdirSync(stage, { recursive: true })) {
    const file = path.join(stage, rel);
    const name = path.basename(rel);
    if (PRIVATE_DIRS.some(dir => rel === dir || rel.startsWith(dir + path.sep))) problems.push(`${rel}: user data`);
    if (name.startsWith('.env') && name !== '.env.example') problems.push(`${rel}: settings file`);
    if (!statSync(file).isFile()) continue;
    files++;
    bytes += statSync(file).size;
    const ours = rel.startsWith(`server${path.sep}`) && !rel.startsWith(path.join('server', 'node_modules'));
    if (ours && TEXT.test(name) && KEY.test(readFileSync(file, 'latin1'))) problems.push(`${rel}: key-shaped string`);
}
if (problems.length) {
    rmSync(server, { recursive: true, force: true });
    throw new Error(`Refusing to stage:\n${problems.join('\n')}`);
}
console.log(`staged ${files} files, ${(bytes / 1e6).toFixed(0)} MB in ${path.relative(process.cwd(), stage)}`);
