import { NextRequest, NextResponse } from 'next/server';
import { getAnalysisJob } from '@/lib/analyzeJob';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const jobId = request.nextUrl.searchParams.get('job');
    const job = jobId ? getAnalysisJob(jobId) : undefined;
    if (!job) {
        return NextResponse.json(
            { success: false, status: 'unknown', error: 'Unknown or expired analysis job' },
            { status: 404 }
        );
    }
    if (job.status === 'running') {
        return NextResponse.json({ success: true, status: 'running', stage: job.stage });
    }
    if (job.status === 'error') {
        return NextResponse.json({ success: false, status: 'error', error: job.error });
    }
    return NextResponse.json({ success: true, status: 'done', data: job.result });
}
