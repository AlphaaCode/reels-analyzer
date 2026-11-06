import { NextRequest, NextResponse } from 'next/server';
import { tmpdir } from 'node:os';
import { checkGate } from '@/lib/agent/claude';
import { AnalysisError, findVideo } from '@/lib/analyzeJob';
import { editReelCommand, startEditJob } from '@/lib/edit/job';

export const dynamic = 'force-dynamic';

// What a run would edit: the source's URL and the /edit-reel command, before anything starts
export async function GET(request: NextRequest) {
    try {
        const video = await findVideo(request.nextUrl.searchParams.get('fileId'));
        return NextResponse.json({ success: true, sourceUrl: video.publicUrl, command: editReelCommand(video.path) });
    } catch (error) {
        const status = error instanceof AnalysisError ? error.status : 500;
        return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown video' }, { status });
    }
}

// Prepare a job folder for the reel and let the user's own Claude Code plan
// the edit in it. Returns at once; the client polls /api/edit/status.
export async function POST(request: NextRequest) {
    try {
        const gate = await checkGate({ cwd: tmpdir() });
        if (!gate.ok) return NextResponse.json({ success: false, error: 'Claude Code is not ready', gate }, { status: 409 });
        const { fileId } = await request.json();
        return NextResponse.json({ success: true, jobId: await startEditJob(fileId) });
    } catch (error) {
        if (error instanceof AnalysisError) {
            return NextResponse.json({ success: false, error: error.message }, { status: error.status });
        }
        console.error('Edit start error:', error);
        return NextResponse.json({ success: false, error: 'Failed to start the edit' }, { status: 500 });
    }
}
