'use client';

import React, { useCallback, useState, useRef } from 'react';
import { validateVideoFile, validateVideoDuration } from '@/lib/validators';
import { useLang } from '@/lib/i18n';

interface UploadZoneProps {
    onFileSelect: (file: File) => void;
    isUploading?: boolean;
    disabled?: boolean;
}

type DragState = 'idle' | 'hover' | 'invalid';

export default function UploadZone({ onFileSelect, isUploading = false, disabled = false }: UploadZoneProps) {
    const { t } = useLang();
    const [dragState, setDragState] = useState<DragState>('idle');
    const [errors, setErrors] = useState<string[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback(async (file: File) => {
        setErrors([]);
        setWarnings([]);

        // Validate file type and size
        const fileValidation = validateVideoFile(file);
        if (!fileValidation.isValid) {
            setErrors(fileValidation.errors);
            return;
        }

        // Validate duration
        const durationValidation = await validateVideoDuration(file);
        if (!durationValidation.isValid) {
            setErrors(durationValidation.errors);
            return;
        }

        // Set warnings (non-blocking)
        if (durationValidation.warnings.length > 0) {
            setWarnings(durationValidation.warnings);
        }

        onFileSelect(file);
    }, [onFileSelect]);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setDragState('idle');

        if (disabled || isUploading) return;

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            handleFile(files[0]);
        }
    }, [disabled, isUploading, handleFile]);

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (disabled || isUploading) return;

        const items = Array.from(e.dataTransfer.items);
        const hasVideo = items.some(item => item.type.startsWith('video/'));
        setDragState(hasVideo ? 'hover' : 'invalid');
    }, [disabled, isUploading]);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setDragState('idle');
    }, []);

    const handleClick = () => {
        if (!disabled && !isUploading) {
            fileInputRef.current?.click();
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            handleFile(files[0]);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    };

    return (
        <div className="w-full max-w-2xl mx-auto">
            {/* Drop Zone */}
            <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={handleClick}
                className={`
          relative p-12 rounded-2xl border-2 border-dashed cursor-pointer
          transition-all duration-300 ease-out
          ${dragState === 'hover'
                        ? 'border-pink-500 bg-gradient-to-br from-pink-500/10 to-orange-500/10 scale-[1.02]'
                        : dragState === 'invalid'
                            ? 'border-red-500 bg-red-500/5'
                            : 'border-gray-600 bg-gray-800/50 hover:border-pink-500/50 hover:bg-gray-800/70'}
          ${(disabled || isUploading) ? 'opacity-50 cursor-not-allowed' : ''}
        `}
            >
                {/* Gradient background effect */}
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-pink-500/5 to-orange-500/5 opacity-0 hover:opacity-100 transition-opacity pointer-events-none" />

                <div className="relative flex flex-col items-center gap-4 text-center">
                    {/* Icon */}
                    <div className={`
            p-4 rounded-full bg-gradient-to-br from-pink-500/20 to-orange-500/20
            ${dragState === 'hover' ? 'animate-pulse' : ''}
          `}>
                        <svg
                            className="w-12 h-12 text-pink-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                            />
                        </svg>
                    </div>

                    {/* Text */}
                    <div>
                        <p className="text-xl font-semibold text-white mb-1">
                            {isUploading ? t('uploadUploading') : t('uploadDrop')}
                        </p>
                        <p className="text-gray-400">
                            {t('uploadOr')} <span className="text-pink-400 hover:text-pink-300 transition-colors">{t('uploadBrowse')}</span> {t('uploadBrowseSuffix')}
                        </p>
                    </div>

                    {/* File info */}
                    <div className="flex flex-wrap justify-center gap-3 text-sm text-gray-500">
                        <span className="px-3 py-1 rounded-full bg-gray-700/50">MP4, MOV, WEBM</span>
                        <span className="px-3 py-1 rounded-full bg-gray-700/50">{t('chipMax')}</span>
                        <span className="px-3 py-1 rounded-full bg-gray-700/50">{t('chipOptimal')}</span>
                    </div>
                </div>

                {/* Hidden file input */}
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    onChange={handleFileInput}
                    className="hidden"
                    disabled={disabled || isUploading}
                />
            </div>

            {/* Errors */}
            {errors.length > 0 && (
                <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                    {errors.map((error, i) => (
                        <p key={i} className="text-red-400 text-sm flex items-center gap-2">
                            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            {error}
                        </p>
                    ))}
                </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && errors.length === 0 && (
                <div className="mt-4 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
                    {warnings.map((warning, i) => (
                        <p key={i} className="text-yellow-400 text-sm flex items-center gap-2">
                            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            {warning}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
