// Video validation utilities

import {
    ACCEPTED_MIME_TYPES,
    MAX_VIDEO_SIZE_BYTES,
    MAX_VIDEO_SIZE_LABEL,
    OPTIMAL_MIN_DURATION,
    OPTIMAL_MAX_DURATION,
    ABSOLUTE_MAX_DURATION
} from './constants';
import type { VideoValidationResult } from '@/types/video';

/**
 * Validate video file on client-side before upload
 */
export function validateVideoFile(file: File): VideoValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file type
    if (!ACCEPTED_MIME_TYPES.includes(file.type as typeof ACCEPTED_MIME_TYPES[number])) {
        errors.push(`Invalid file format. Accepted: MP4, MOV, WEBM. Got: ${file.type || 'unknown'}`);
    }

    // Check file size
    if (file.size > MAX_VIDEO_SIZE_BYTES) {
        const sizeMB = Math.round(file.size / (1024 * 1024));
        errors.push(`File too large. Maximum: ${MAX_VIDEO_SIZE_LABEL}. Your file: ${sizeMB}MB`);
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate video duration (async - needs to read video metadata)
 */
export async function validateVideoDuration(file: File): Promise<VideoValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';

        video.onloadedmetadata = () => {
            URL.revokeObjectURL(video.src);
            const duration = video.duration;

            if (duration > ABSOLUTE_MAX_DURATION) {
                errors.push(`Video too long. Maximum: ${ABSOLUTE_MAX_DURATION} seconds. Your video: ${Math.round(duration)} seconds`);
            } else if (duration < OPTIMAL_MIN_DURATION) {
                warnings.push(`Short video (${Math.round(duration)}s). Optimal: ${OPTIMAL_MIN_DURATION}-${OPTIMAL_MAX_DURATION} seconds`);
            } else if (duration > OPTIMAL_MAX_DURATION) {
                warnings.push(`Long video (${Math.round(duration)}s). Optimal: ${OPTIMAL_MIN_DURATION}-${OPTIMAL_MAX_DURATION} seconds`);
            }

            resolve({
                isValid: errors.length === 0,
                errors,
                warnings
            });
        };

        video.onerror = () => {
            URL.revokeObjectURL(video.src);
            resolve({
                isValid: false,
                errors: ['Could not read video metadata. File may be corrupted.'],
                warnings
            });
        };

        video.src = URL.createObjectURL(file);
    });
}

/**
 * Get video metadata from file
 */
export async function getVideoMetadata(file: File): Promise<{
    duration: number;
    width: number;
    height: number;
    aspectRatio: string;
}> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';

        video.onloadedmetadata = () => {
            URL.revokeObjectURL(video.src);
            const width = video.videoWidth;
            const height = video.videoHeight;

            // Calculate aspect ratio
            const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
            const divisor = gcd(width, height);
            const aspectRatio = `${width / divisor}:${height / divisor}`;

            resolve({
                duration: video.duration,
                width,
                height,
                aspectRatio
            });
        };

        video.onerror = () => {
            URL.revokeObjectURL(video.src);
            reject(new Error('Could not read video metadata'));
        };

        video.src = URL.createObjectURL(file);
    });
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
