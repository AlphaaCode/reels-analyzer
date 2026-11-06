// Uploads and the Instagram cache, served from the data folder (paths.ts):
// /api/media/uploads/{file} and /api/media/ig-cache/{file}. The desktop app
// keeps them in %APPDATA%, outside public/, where Next can't serve them as
// static files. Only known media types, only inside those two folders, and
// with Range requests so a video seeks the way a static file does.
//
// Node runs this file directly in tests, so it imports node: modules and .ts paths only.

import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { dataRoot } from './paths.ts';

const AREAS = new Set(['uploads', 'ig-cache']);
const TYPES: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.json': 'application/json'
};
// One plain name per segment: no '..', no separators, no drive letters or ':' streams
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The file a media path names inside root/public/{uploads|ig-cache}, or undefined. */
export function mediaFile(segments: string[], root = dataRoot()): string | undefined {
    const [area, ...rest] = segments;
    if (!AREAS.has(area) || rest.length === 0 || !rest.every(segment => SEGMENT.test(segment))) return undefined;
    if (!TYPES[path.extname(rest[rest.length - 1]).toLowerCase()]) return undefined;
    const base = path.resolve(root, 'public', area);
    const file = path.resolve(base, ...rest);
    return file.startsWith(base + path.sep) ? file : undefined;
}

function fileSize(file: string): number | undefined {
    try {
        const info = statSync(file);
        return info.isFile() ? info.size : undefined;
    } catch {
        return undefined;
    }
}

const body = (file: string, start?: number, end?: number): BodyInit =>
    Readable.toWeb(createReadStream(file, { start, end })) as unknown as BodyInit;

export function serveMedia(request: Request, segments: string[], root = dataRoot()): Response {
    const file = mediaFile(segments, root);
    const size = file === undefined ? undefined : fileSize(file);
    if (file === undefined || size === undefined) return new Response('Not found', { status: 404 });
    const headers = {
        'Content-Type': TYPES[path.extname(file).toLowerCase()],
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
    };

    // One range, as browsers send for media; anything unparseable gets the whole file
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range')?.trim() ?? '');
    if (!range || (!range[1] && !range[2])) {
        return new Response(body(file), { headers: { ...headers, 'Content-Length': String(size) } });
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    return new Response(body(file, start, end), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
    });
}
