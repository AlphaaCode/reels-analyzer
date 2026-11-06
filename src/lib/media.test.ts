// Run with: npm test
// The media route serves uploads and the Instagram cache from the data folder:
// whole files, byte ranges for video seeking, and nothing outside the two folders.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mediaFile, serveMedia } from './media.ts';

const root = mkdtempSync(path.join(tmpdir(), 'media-'));
mkdirSync(path.join(root, 'public', 'uploads'), { recursive: true });
mkdirSync(path.join(root, 'public', 'ig-cache'), { recursive: true });
mkdirSync(path.join(root, 'data'), { recursive: true });
writeFileSync(path.join(root, 'public', 'uploads', 'clip.mp4'), '0123456789');
writeFileSync(path.join(root, 'public', 'uploads', 'notes.txt'), 'not media');
writeFileSync(path.join(root, 'public', 'ig-cache', 'profile.json'), '{"reels":[]}');
writeFileSync(path.join(root, 'data', 'analyses.json'), '[]');
writeFileSync(path.join(root, '.env.local'), 'SECRET=1');
test.after(() => rmSync(root, { recursive: true, force: true }));

const get = (segments: string[], range?: string): Response =>
    serveMedia(new Request('http://localhost/api/media', { headers: range ? { range } : {} }), segments, root);

test('serves a whole file with its type', async () => {
    const video = get(['uploads', 'clip.mp4']);
    assert.equal(video.status, 200);
    assert.equal(video.headers.get('content-type'), 'video/mp4');
    assert.equal(video.headers.get('accept-ranges'), 'bytes');
    assert.equal(video.headers.get('content-length'), '10');
    assert.equal(await video.text(), '0123456789');

    const profile = get(['ig-cache', 'profile.json']);
    assert.equal(profile.headers.get('content-type'), 'application/json');
    assert.deepEqual(await profile.json(), { reels: [] });
});

test('serves byte ranges, so a video can seek', async () => {
    const cases: [range: string, text: string, contentRange: string][] = [
        ['bytes=0-', '0123456789', 'bytes 0-9/10'],
        ['bytes=2-5', '2345', 'bytes 2-5/10'],
        ['bytes=7-', '789', 'bytes 7-9/10'],
        ['bytes=-3', '789', 'bytes 7-9/10'],
        ['bytes=8-99', '89', 'bytes 8-9/10']
    ];
    for (const [range, text, contentRange] of cases) {
        const response = get(['uploads', 'clip.mp4'], range);
        assert.equal(response.status, 206, range);
        assert.equal(response.headers.get('content-range'), contentRange, range);
        assert.equal(response.headers.get('content-length'), String(text.length), range);
        assert.equal(await response.text(), text, range);
    }

    const past = get(['uploads', 'clip.mp4'], 'bytes=10-');
    assert.equal(past.status, 416);
    assert.equal(past.headers.get('content-range'), 'bytes */10');
    // Not one plain range: the whole file
    assert.equal(get(['uploads', 'clip.mp4'], 'bytes=0-1,4-5').status, 200);
});

test('nothing outside uploads and the Instagram cache, and only media types', () => {
    const refused = [
        ['uploads'],
        ['data', 'analyses.json'],
        ['public', 'uploads', 'clip.mp4'],
        ['uploads', '..', '..', '.env.local'],
        ['uploads', '..', '..', 'data', 'analyses.json'],
        ['uploads', '../../.env.local'],
        ['uploads', '..\\..\\.env.local'],
        ['uploads', 'C:', 'Windows', 'win.ini'],
        ['uploads', 'clip.mp4:hidden'],
        ['uploads', '.env.local'],
        ['uploads', 'notes.txt'],
        ['uploads', ''],
        ['ig-cache', '%2e%2e', 'profile.json']
    ];
    for (const segments of refused) {
        assert.equal(mediaFile(segments, root), undefined, segments.join(' / '));
        assert.equal(get(segments).status, 404, segments.join(' / '));
    }
    assert.equal(get(['uploads', 'missing.mp4']).status, 404);
    assert.equal(mediaFile(['uploads', 'clip.mp4'], root), path.join(root, 'public', 'uploads', 'clip.mp4'));
});
