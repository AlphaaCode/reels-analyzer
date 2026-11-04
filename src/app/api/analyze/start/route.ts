import { NextRequest, NextResponse } from 'next/server';
import { AnalysisError, startAnalysisJob } from '@/lib/analyzeJob';

export const dynamic = 'force-dynamic';

// Kick off an analysis job and return immediately — the client polls
// /api/analyze/status. Keeps every request short enough for free-host proxies.
export async function POST(request: NextRequest) {
    try {
        const { fileId, actual, scoresOnly } = await request.json();
        const jobId = startAnalysisJob(fileId, actual, Boolean(scoresOnly));
        return NextResponse.json({ success: true, jobId });
    } catch (error) {
        if (error instanceof AnalysisError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error('Analysis start error:', error);
        return NextResponse.json({ success: false, error: 'Failed to start analysis' }, { status: 500 });
    }
}
