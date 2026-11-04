'use client';

import React from 'react';
import Image from 'next/image';
import { useLang } from '@/lib/i18n';

export default function Header() {
    const { lang, setLang, t } = useLang();

    return (
        <header className="w-full py-6 px-4">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center shadow-lg shadow-pink-500/10 p-1.5">
                        <Image src="/arrow.png" alt="Reels Analyzer" width={32} height={32} className="w-full h-full object-contain" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-red-400 to-orange-400 bg-clip-text text-transparent">
                            Reels Analyzer
                        </h1>
                        <p className="text-xs text-gray-500">{t('tagline')}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Language toggle */}
                    <button
                        onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                        className="px-3 py-1.5 rounded-full border border-gray-700 text-sm text-gray-300 hover:border-pink-500/50 hover:text-white transition-colors"
                    >
                        {lang === 'en' ? 'العربية' : 'English'}
                    </button>

                    {/* Badge */}
                    <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-pink-500/10 to-orange-500/10 border border-pink-500/20">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-sm text-gray-300">{t('badge')}</span>
                    </div>
                </div>
            </div>
        </header>
    );
}
