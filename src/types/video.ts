// Video file validation and metadata types

export interface VideoMetadata {
    fileId: string;
    filename: string;
    duration: number; // in seconds
    size: number; // in bytes
    format: string; // mp4, mov, webm
    thumbnailUrl: string;
    aspectRatio: string; // 9:16, 16:9, etc
    width: number;
    height: number;
}

export interface UploadResponse {
    success: boolean;
    data?: VideoMetadata;
    error?: string;
}

export interface VideoValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export type AcceptedVideoFormat = 'video/mp4' | 'video/quicktime' | 'video/webm';

export const ACCEPTED_FORMATS: AcceptedVideoFormat[] = [
    'video/mp4',
    'video/quicktime',
    'video/webm'
];

export const FORMAT_EXTENSIONS: Record<AcceptedVideoFormat, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm'
};
