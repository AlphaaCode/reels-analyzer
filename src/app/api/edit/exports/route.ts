import { NextResponse } from 'next/server';
import { listExports } from '@/lib/edit/job';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({ success: true, exports: listExports() });
}
