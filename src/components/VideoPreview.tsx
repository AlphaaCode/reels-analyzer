'use client';

import React from 'react';
import { formatFileSize, formatDuration } from '@/lib/validators';
import { useLang } from '@/lib/i18n';
import type { VideoMetadata } from '@/types/video';

interface VideoPreviewProps {
    file: File;
    metadata?: Partial<VideoMetadata>;
    onRemove: () => void;
    onAnalyze: () => void;
    isAnalyzing?: boolean;
    uploadPercent?: number;   // set while the file is still uploading
}

export default function VideoPreview({
    file,
    metadata,
    onRemove,
    onAnalyze,
    isAnalyzing = false,
    uploadPercent
}: VideoPreviewProps) {
    const { t } = useLang();
    // Analysis cannot start before the bytes reach the server
    const busy = isAnalyzing || uploadPercent !== undefined;
    const videoUrl = React.useMemo(() => URL.createObjectURL(file), [file]);

    React.useEffect(() => {
        return () => URL.revokeObjectURL(videoUrl);
    }, [videoUrl]);

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div className="rounded-2xl overflow-hidden bg-gray-800/50 border border-gray-700">
                {/* Video Player */}
                <div className="relative aspect-[9/16] max-h-[500px] bg-black mx-auto">
                    <video
                        src={videoUrl}
                        controls
                        className="w-full h-full object-contain"
                        playsInline
                    />
                </div>

                {/* Metadata */}
                <div className="p-6">
                    {/* Filename */}
                    <h3 className="text-lg font-semibold text-white truncate mb-4" title={file.name}>
                        {file.name}
                    </h3>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                        <div className="text-center p-3 rounded-xl bg-gray-700/50">
                            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">{t('labelDuration')}</p>
                            <p className="text-white font-medium">
                                {metadata?.duration ? formatDuration(metadata.duration) : '--:--'}
                            </p>
                        </div>
                        <div className="text-center p-3 rounded-xl bg-gray-700/50">
                            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">{t('labelSize')}</p>
                            <p className="text-white font-medium">{formatFileSize(file.size)}</p>
                        </div>
                        <div className="text-center p-3 rounded-xl bg-gray-700/50">
                            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">{t('labelFormat')}</p>
                            <p className="text-white font-medium uppercase">
                                {file.name.split('.').pop() || 'MP4'}
                            </p>
                        </div>
                        <div className="text-center p-3 rounded-xl bg-gray-700/50">
                            <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">{t('labelRatio')}</p>
                            <p className="text-white font-medium">
                                {metadata?.aspectRatio || '--:--'}
                            </p>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            onClick={onRemove}
                            disabled={busy}
                            className="
                flex-1 py-3 px-6 rounded-xl font-medium
                bg-gray-700 text-gray-300 hover:bg-gray-600
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              "
                        >
                            {t('btnRemove')}
                        </button>
                        <button
                            onClick={onAnalyze}
                            disabled={busy}
                            className="
                flex-1 py-3 px-6 rounded-xl font-semibold
                bg-gradient-to-r from-pink-500 to-orange-500
                text-white shadow-lg shadow-pink-500/25
                hover:shadow-pink-500/40 hover:scale-[1.02]
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
              "
                        >
                            {busy ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    {uploadPercent === undefined ? t('btnAnalyzing') : t('uploadUploading') + ' ' + uploadPercent + '%'}
                                </span>
                            ) : (
                                t('btnAnalyze')
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
