'use client';

// "My Instagram" section — renders the locally cached profile snapshot
// (ig-cache/profile.json in the data folder) with real per-reel stats and an
// Analyze button that feeds each cached video into the normal analysis pipeline.

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useLang } from '@/lib/i18n';
import type { ActualPerformance } from '@/types/analysis';

interface IgReelStats {
    views: number;
    reach: number;
    likes: number;
    comments: number;
    saved: number;
    shares: number;
    totalInteractions: number;
}

interface IgReel {
    mediaId: string;
    fileId: string;
    caption: string;
    permalink: string;
    timestamp: string;
    video: string;
    thumb: string;
    stats: IgReelStats;
}

interface IgProfile {
    username: string;
    followers: number;
    posts: number;
    biography: string;
    permalink: string;
    avatar: string;
    fetchedAt: string;
    reels: IgReel[];
}

interface MyInstagramProps {
    onAnalyzeReel: (fileId: string, label: string, actual: ActualPerformance) => void;
}

// The cache's files are served from the data folder by /api/media (src/lib/media.ts)
const media = (url: string): string => (url.startsWith('/ig-cache/') ? `/api/media${url}` : url);

export default function MyInstagram({ onAnalyzeReel }: MyInstagramProps) {
    const { t } = useLang();
    const [profile, setProfile] = useState<IgProfile | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/media/ig-cache/profile.json')
            .then(res => (res.ok ? res.json() : null))
            .then(data => {
                if (!cancelled && data?.reels?.length) setProfile(data);
            })
            .catch(() => {
                // no cache yet — section stays hidden
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!profile) return null;

    return (
        <section className="max-w-5xl mx-auto mt-16 animate-fade-in">
            {/* Profile header */}
            <div className="flex items-center gap-4 mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={media(profile.avatar)}
                    alt={profile.username}
                    className="w-14 h-14 rounded-full border border-gray-700 object-cover"
                />
                <div className="flex-1">
                    <a
                        href={profile.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-lg font-bold text-white hover:text-pink-400 transition-colors"
                    >
                        @{profile.username}
                    </a>
                    <p className="text-sm text-gray-400">
                        {profile.followers.toLocaleString()} {t('igFollowers')} · {profile.posts} {t('igPosts')}
                    </p>
                </div>
                <h3 className="text-xl font-bold bg-gradient-to-r from-pink-400 to-orange-400 bg-clip-text text-transparent">
                    {t('igTitle')}
                </h3>
            </div>
            <p className="text-xs text-gray-600 mb-6">{t('igCachedNote')}</p>

            {/* Reels grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {profile.reels.map(reel => (
                    <div
                        key={reel.mediaId}
                        className="rounded-xl overflow-hidden bg-gray-800/50 border border-gray-700/50 flex flex-col hover:border-pink-500/30 transition-colors"
                    >
                        <a href={reel.permalink} target="_blank" rel="noreferrer" className="relative block aspect-[9/16] bg-black">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={media(reel.thumb)} alt="" className="w-full h-full object-cover" loading="lazy" />
                            <span className="absolute bottom-1.5 left-1.5 right-1.5 text-[11px] font-semibold text-white bg-black/60 rounded-md px-1.5 py-0.5 text-center">
                                {reel.stats.views.toLocaleString()} {t('igViews')}
                            </span>
                        </a>
                        <div className="p-2.5 flex flex-col gap-2 flex-1">
                            <p className="text-xs text-gray-300 line-clamp-2 min-h-[2rem]">{reel.caption || '—'}</p>
                            <div className="flex items-center gap-2.5 text-[11px] text-gray-400">
                                <span className="flex items-center gap-1">
                                    <Image src="/heart.png" alt="likes" width={12} height={12} className="w-3 h-3 object-contain" />
                                    {reel.stats.likes.toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Image src="/engagement.png" alt="shares" width={12} height={12} className="w-3 h-3 object-contain" />
                                    {reel.stats.shares.toLocaleString()}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Image src="/star.png" alt="saves" width={12} height={12} className="w-3 h-3 object-contain" />
                                    {reel.stats.saved.toLocaleString()}
                                </span>
                            </div>
                            <button
                                onClick={() => onAnalyzeReel(reel.fileId, reel.caption || `reel ${reel.mediaId}`, {
                                    views: reel.stats.views,
                                    reach: reel.stats.reach,
                                    likes: reel.stats.likes,
                                    comments: reel.stats.comments,
                                    saved: reel.stats.saved,
                                    shares: reel.stats.shares,
                                    followers: profile.followers,
                                    postedAt: reel.timestamp
                                })}
                                className="mt-auto w-full py-1.5 rounded-lg bg-gradient-to-r from-pink-500 to-orange-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                            >
                                {t('igAnalyze')}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
