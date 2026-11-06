import { NextRequest, NextResponse } from 'next/server';
import { AnalysisError } from '@/lib/analyzeJob';
import { renderEditJob } from '@/lib/edit/job';

export const dynamic = 'force-dynamic';

// Render the ops the user kept; the client polls /api/edit/status for the diff.
export async function POST(request: NextRequest) {
    try {
        const { job, enabledOps } = await request.json();
        renderEditJob(job, enabledOps);
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof AnalysisError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error('Edit render error:', error);
        return NextResponse.json({ success: false, error: 'Failed to start the render' }, { status: 500 });
    }
}
