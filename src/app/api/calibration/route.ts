import { NextResponse } from 'next/server';
import { getCalibration } from '@/lib/calibrationStore';
import { buildLabelledReels, instrumentKey } from '@/lib/calibration';
import { readHistory } from '@/lib/history';

export const dynamic = 'force-dynamic';

// Account-level view for the track record panel: what the app has learned about
// itself so far. Cheap after the first call — the calibration is cached on disk
// and only recomputed when new analyses land.
export async function GET() {
    try {
        const calibration = getCalibration();
        if (!calibration) return NextResponse.json({ success: true, data: null });

        const records = readHistory();
        const reels = buildLabelledReels(records);
        const instruments: Record<string, number> = {};
        for (const record of records) {
            const key = instrumentKey(record) || `${record.provider}:heuristic`;
            instruments[key] = (instruments[key] ?? 0) + 1;
        }

        return NextResponse.json({
            success: true,
            data: {
                n: calibration.n,
                unlocked: calibration.unlocked,
                lockReason: calibration.lockReason,
                alarm: calibration.alarm,
                score: calibration.score,
                scoreRaw: calibration.scoreRaw,
                recencyRho: calibration.recencyRho,
                survivors: calibration.survivors,
                exploratory: [...calibration.exploratory]
                    .sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))
                    .slice(0, 4),
                noiseFloor: calibration.noiseFloor,
                breakoutThreshold: calibration.breakoutThreshold,
                breakoutCount: reels.filter(reel => reel.reach >= calibration.breakoutThreshold).length,
                reaches: reels.map(reel => reel.reach).sort((a, b) => a - b),
                instruments,
                generatedAt: calibration.generatedAt
            }
        });
    } catch (error) {
        console.error('Calibration read failed:', error);
        return NextResponse.json({ success: false, error: 'Could not read the calibration' }, { status: 500 });
    }
}
