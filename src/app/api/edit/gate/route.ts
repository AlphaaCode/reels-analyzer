import { NextRequest, NextResponse } from 'next/server';
import { tmpdir } from 'node:os';
import { checkGate } from '@/lib/agent/claude';

export const dynamic = 'force-dynamic';

// Can this machine plan edits with the user's own Claude Code? Cached for 10
// minutes; ?fresh=1 re-checks. A convenience gate, not a licence check.
export async function GET(request: NextRequest) {
    const gate = await checkGate({ fresh: request.nextUrl.searchParams.get('fresh') === '1', cwd: tmpdir() });
    return NextResponse.json(gate);
}
