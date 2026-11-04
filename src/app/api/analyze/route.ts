import { NextRequest, NextResponse } from 'next/server';
import { AnalysisError, runAnalysisPipeline } from '@/lib/analyzeJob';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // signal extraction + Gemini video processing can take a while

// One-shot analysis, kept for local use and scripted probes. Deployed UIs use
// /api/analyze/start + /api/analyze/status instead — free-host proxies cut
// responses that take longer than ~100s.
export async function POST(request: NextRequest) {
    try {
        const { fileId, actual, scoresOnly } = await request.json();
        const result = await runAnalysisPipeline(fileId, actual, { scoresOnly: Boolean(scoresOnly) });
        return NextResponse.json({ success: true, data: result });
    } catch (error) {
        if (error instanceof AnalysisError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error('Analysis error:', error);
        const message = error instanceof Error ? error.message : 'Failed to analyze video';
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
