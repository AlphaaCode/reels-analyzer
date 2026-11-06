// Run with: npm test
// Without APP_DATA_DIR every writable path is where it always was; with it,
// all of them move to that one folder.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dataRoot, igCacheDir, uploadsDir } from './paths.ts';

function withDataDir(value: string | undefined, run: () => void): void {
    const saved = process.env.APP_DATA_DIR;
    if (value === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = value;
    try {
        run();
    } finally {
        if (saved === undefined) delete process.env.APP_DATA_DIR;
        else process.env.APP_DATA_DIR = saved;
    }
}

test('unset, the data folder is the root or the working directory', () => {
    withDataDir(undefined, () => {
        assert.equal(dataRoot(), process.cwd());
        assert.equal(dataRoot('/repo'), '/repo');
        assert.equal(uploadsDir(), path.join(process.cwd(), 'public', 'uploads'));
        assert.equal(igCacheDir(), path.join(process.cwd(), 'public', 'ig-cache'));
    });
    // A blanked variable counts as unset
    withDataDir('  ', () => assert.equal(dataRoot('/repo'), '/repo'));
});

test('APP_DATA_DIR wins over the root, resolved to an absolute path', () => {
    const appData = path.resolve('app-data');
    withDataDir(appData, () => {
        assert.equal(dataRoot(), appData);
        assert.equal(dataRoot('/repo'), appData);
        assert.equal(uploadsDir(), path.join(appData, 'public', 'uploads'));
        assert.equal(igCacheDir(), path.join(appData, 'public', 'ig-cache'));
    });
    withDataDir('app-data', () => assert.equal(dataRoot(), appData));
});
