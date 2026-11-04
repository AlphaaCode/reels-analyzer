import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UPLOAD_MAX_AGE_HOURS, UPLOAD_KEEP_RECENT, MAX_VIDEO_SIZE_BYTES, MAX_VIDEO_SIZE_LABEL } from '@/lib/constants';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

// Uploads are a local cache — drop old files, but never the newest few
async function sweepOldUploads(): Promise<void> {
    const cutoff = Date.now() - UPLOAD_MAX_AGE_HOURS * 60 * 60 * 1000;
    const entries = await readdir(UPLOAD_DIR);
    const files: { path: string; mtimeMs: number }[] = [];
    for (const entry of entries) {
        const entryPath = path.join(UPLOAD_DIR, entry);
        try {
            const info = await stat(entryPath);
            if (info.isFile()) {
                files.push({ path: entryPath, mtimeMs: info.mtimeMs });
            }
        } catch {
            // ignore entries we cannot stat
        }
    }
    const sweepable = files
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .slice(UPLOAD_KEEP_RECENT);
    for (const file of sweepable) {
        if (file.mtimeMs < cutoff) {
            try {
                await unlink(file.path);
            } catch {
                // ignore files we cannot delete
            }
        }
    }
}

export async function POST(request: NextRequest) {
    try {
        // Ensure upload directory exists
        if (!existsSync(UPLOAD_DIR)) {
            await mkdir(UPLOAD_DIR, { recursive: true });
        }
        await sweepOldUploads().catch(() => { /* best effort */ });

        // Parse form data
        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json(
                { success: false, error: 'No file provided' },
                { status: 400 }
            );
        }

        // Validate file type
        if (!ACCEPTED_TYPES.includes(file.type)) {
            return NextResponse.json(
                { success: false, error: `Invalid file type: ${file.type}. Accepted: MP4, MOV, WEBM` },
                { status: 400 }
            );
        }

        // Validate file size
        if (file.size > MAX_VIDEO_SIZE_BYTES) {
            const sizeMB = Math.round(file.size / (1024 * 1024));
            return NextResponse.json(
                { success: false, error: `File too large: ${sizeMB}MB. Maximum: ${MAX_VIDEO_SIZE_LABEL}` },
                { status: 400 }
            );
        }

        // Generate unique filename
        const fileId = uuidv4();
        const extension = file.name.split('.').pop()?.toLowerCase() || 'mp4';
        const filename = `${fileId}.${extension}`;
        const filePath = path.join(UPLOAD_DIR, filename);

        // Write file to disk
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(filePath, buffer);

        // Return success response
        return NextResponse.json({
            success: true,
            data: {
                fileId,
                filename: file.name,
                storedFilename: filename,
                size: file.size,
                format: extension,
                path: `/uploads/${filename}`
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to upload file' },
            { status: 500 }
        );
    }
}

// Configure max body size for this route

