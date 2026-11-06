// Fetch the ffmpeg the desktop app ships: BtbN's LGPL win64 shared build of
// FFmpeg 9.0, pinned to a month-end autobuild (BtbN keeps those for about two
// years) and checked against its SHA256. Keeps ffmpeg.exe, ffprobe.exe and
// their DLLs in stage/ffmpeg, writes the licence and the source link to
// stage/licenses/ffmpeg, and fails unless the filters and the H.264 encoder
// the app needs are there.
//
//   node fetch-ffmpeg.mjs
//
// To move to a newer build: pick a month-end autobuild-* release on
// https://github.com/BtbN/FFmpeg-Builds/releases, take its
// ffmpeg-n<version>-...-win64-lgpl-shared-<major>.zip and that file's line in
// checksums.sha256, and update BUILD.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILD = {
    release: 'autobuild-2026-10-31-12-59',
    name: 'ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0',
    sha256: 'e907b01fa4783913151237e37df2a10fa97d99a1598a021bf59d4ae62ffed4c0',
    source: 'https://github.com/FFmpeg/FFmpeg/tree/7adfbe40dc'
};
const NEEDED_FILTERS = ['subtitles', 'loudnorm', 'silencedetect'];

const here = path.dirname(fileURLToPath(import.meta.url));
const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${BUILD.release}/${BUILD.name}.zip`;
const cache = path.join(here, '.cache');
const zip = path.join(cache, `${BUILD.name}.zip`);
const unpacked = path.join(cache, BUILD.name);
const out = path.join(here, 'stage', 'ffmpeg');
const licenses = path.join(here, 'stage', 'licenses', 'ffmpeg');

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

mkdirSync(cache, { recursive: true });
if (!existsSync(zip) || sha256(zip) !== BUILD.sha256) {
    console.log(`downloading ${url}`);
    execFileSync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '--connect-timeout', '30', '-o', zip, url], { stdio: 'inherit' });
}
const actual = sha256(zip);
if (actual !== BUILD.sha256) throw new Error(`${BUILD.name}.zip has SHA256 ${actual}, expected ${BUILD.sha256}`);

// Windows' own tar (bsdtar) reads zip files; Git's GNU tar, which can come first on PATH, doesn't
rmSync(unpacked, { recursive: true, force: true });
execFileSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', cache]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const bin = path.join(unpacked, 'bin');
const kept = readdirSync(bin).filter(file => file === 'ffmpeg.exe' || file === 'ffprobe.exe' || file.endsWith('.dll'));
for (const file of kept) copyFileSync(path.join(bin, file), path.join(out, file));

const run = (exe, args) => execFileSync(path.join(out, exe), ['-hide_banner', ...args], { encoding: 'utf8', windowsHide: true });
const version = run('ffmpeg.exe', ['-version']).split(/\r?\n/)[0];
run('ffprobe.exe', ['-version']);
const filters = run('ffmpeg.exe', ['-filters']);
const encoders = run('ffmpeg.exe', ['-encoders']);
const missing = NEEDED_FILTERS.filter(name => !new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(filters));
const h264 = ['libx264', 'libopenh264'].find(name => new RegExp(`^\\s*V\\S*\\s+${name}\\s`, 'm').test(encoders));
if (!h264) missing.push('an H.264 encoder (libx264 or libopenh264)');
if (missing.length) throw new Error(`${BUILD.name} lacks ${missing.join(', ')}`);

rmSync(licenses, { recursive: true, force: true });
mkdirSync(licenses, { recursive: true });
copyFileSync(path.join(unpacked, 'LICENSE.txt'), path.join(licenses, 'LICENSE.txt'));
writeFileSync(path.join(licenses, 'SOURCE.txt'), [
    `ffmpeg.exe, ffprobe.exe and the DLLs beside them are ${version}`,
    'in the LGPL build by BtbN/FFmpeg-Builds, licensed under the GNU LGPL v3 (LICENSE.txt).',
    'Reels Analyzer runs them as separate programs.',
    '',
    `FFmpeg source of this build: ${BUILD.source}`,
    'Build scripts and the sources of the libraries built in: https://github.com/BtbN/FFmpeg-Builds',
    `This build: ${url}`,
    `SHA256: ${BUILD.sha256}`,
    '',
    run('ffmpeg.exe', ['-buildconf']).trim(),
    ''
].join('\r\n'));
rmSync(unpacked, { recursive: true, force: true });

const megabytes = kept.reduce((sum, file) => sum + statSync(path.join(out, file)).size, 0) / 1e6;
console.log(`${version}\n${kept.length} files, ${megabytes.toFixed(0)} MB in ${path.relative(process.cwd(), out)}`);
console.log(`filters ${NEEDED_FILTERS.join(', ')} and encoder ${h264}: present`);
