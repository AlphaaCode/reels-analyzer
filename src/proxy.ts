import { NextRequest, NextResponse } from 'next/server';

// Optional password gate for public deployments: set APP_PASSWORD and every
// request (pages, assets, API) needs HTTP Basic auth — any username, that
// password. Unset (local dev) the gate is a no-op. This protects the
// Gemini free-tier quota and the bundled Instagram analytics on a public URL.
export function proxy(request: NextRequest) {
    const password = process.env.APP_PASSWORD;
    if (!password) return NextResponse.next();

    // Hosts probe this to know the instance is alive — must not need auth
    if (request.nextUrl.pathname === '/api/health') return NextResponse.next();

    const header = request.headers.get('authorization') ?? '';
    if (header.startsWith('Basic ')) {
        try {
            const decoded = atob(header.slice(6));
            const separator = decoded.indexOf(':');
            const provided = separator >= 0 ? decoded.slice(separator + 1) : decoded;
            if (provided === password) return NextResponse.next();
        } catch {
            // malformed base64 — fall through to the challenge
        }
    }

    return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Reels Analyzer", charset="UTF-8"' }
    });
}
