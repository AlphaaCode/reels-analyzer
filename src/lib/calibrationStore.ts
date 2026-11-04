// Cached access to the calibration. The permutation tests take a couple of
// seconds over a dozen predictors, which is nothing next to an AI call but far
// too much per page render — so the result is cached on disk and only recomputed
// when the history it derives from has actually changed.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { METRIC_WEIGHTS } from './constants';
import { buildLabelledReels, calibrate, measureNoiseFloor, type Calibration } from './calibration';
import { readHistory } from './history';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'calibration.json');

interface CachedCalibration extends Calibration {
    /** How many history rows produced this — the cache key. */
    fromRecords?: number;
}

export function getCalibration(): CachedCalibration | undefined {
    const records = readHistory();
    if (records.length === 0) return undefined;

    if (existsSync(FILE)) {
        try {
            const cached = JSON.parse(readFileSync(FILE, 'utf8')) as CachedCalibration;
            if (cached.fromRecords === records.length) return cached;
        } catch {
            // unreadable cache is not worth rescuing — recompute below
        }
    }

    const reels = buildLabelledReels(records);
    const fresh: CachedCalibration = {
        ...calibrate(reels, METRIC_WEIGHTS, { noiseFloor: measureNoiseFloor(records, reels) }),
        fromRecords: records.length
    };

    try {
        if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
        const temp = `${FILE}.tmp`;
        writeFileSync(temp, JSON.stringify(fresh, null, 2));
        renameSync(temp, FILE);
    } catch (error) {
        console.error('Could not cache the calibration:', error);
    }
    return fresh;
}
