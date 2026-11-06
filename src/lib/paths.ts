// Where the app writes: uploads, the Instagram cache, data/ (history,
// calibration, reports, word timestamps, edit jobs), exports/ and .env.local.
// The desktop app sets APP_DATA_DIR to %APPDATA%\Reels Analyzer; unset, it is
// the server's own folder, laid out exactly as a checkout. Read-only assets
// (prompts, schema, fonts, tools, the reel-edit skill) always stay beside the
// server.
//
// Node runs this file directly (tools, tests), so it imports node: modules only.

import path from 'node:path';

/** The folder everything writable lives under; `root` when APP_DATA_DIR is unset (the server's folder, or a tool's repo root). */
export function dataRoot(root = process.cwd()): string {
    const dir = process.env.APP_DATA_DIR?.trim();
    return dir ? path.resolve(dir) : root;
}

export const uploadsDir = (): string => path.join(dataRoot(), 'public', 'uploads');
export const igCacheDir = (): string => path.join(dataRoot(), 'public', 'ig-cache');
