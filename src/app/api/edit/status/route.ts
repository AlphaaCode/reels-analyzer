import { NextRequest, NextResponse } from 'next/server';
import { getEditJob } from '@/lib/edit/job';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const job = getEditJob(request.nextUrl.searchParams.get('job') ?? '');
    if (!job) return NextResponse.json({ success: false, error: 'Unknown or expired edit job' }, { status: 404 });
    return NextResponse.json({ success: true, job });
}
