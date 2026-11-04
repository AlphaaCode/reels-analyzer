import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Unauthenticated health probe — hosts use this to decide the instance is up.
// The middleware exempts this path from the APP_PASSWORD gate.
export function GET() {
    return NextResponse.json({ ok: true });
}
