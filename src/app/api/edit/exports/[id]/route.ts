import { NextRequest, NextResponse } from 'next/server';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { deleteExport, exportPath } from '@/lib/edit/job';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

// The edited video, for the after player.
// ponytail: whole-file responses, no Range; add it if seeking long exports breaks.
export async function GET(_request: NextRequest, { params }: Params) {
    const file = exportPath((await params).id, '.mp4');
    if (!file || !existsSync(file)) return NextResponse.json({ success: false, error: 'No such export' }, { status: 404 });
    return new NextResponse(new Uint8Array(await readFile(file)), {
        headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' }
    });
}

// Copy the export into uploads so the normal analysis can run on it.
export async function POST(_request: NextRequest, { params }: Params) {
    const file = exportPath((await params).id, '.mp4');
    if (!file || !existsSync(file)) return NextResponse.json({ success: false, error: 'No such export' }, { status: 404 });
    const fileId = uuidv4();
    const uploads = path.join(process.cwd(), 'public', 'uploads');
    await mkdir(uploads, { recursive: true });
    await copyFile(file, path.join(uploads, `${fileId}.mp4`));
    return NextResponse.json({ success: true, fileId });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
    return deleteExport((await params).id)
        ? NextResponse.json({ success: true })
        : NextResponse.json({ success: false, error: 'No such export' }, { status: 404 });
}
