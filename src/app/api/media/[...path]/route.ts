import { serveMedia } from '@/lib/media';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ path: string[] }> };

// Uploads and the Instagram cache, from the data folder (src/lib/media.ts)
export async function GET(request: Request, { params }: Params) {
    return serveMedia(request, (await params).path);
}
