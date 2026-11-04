'use client';

// One-dimensional strip plot: every labelled reel as a dot on a log reach axis,
// optionally with this reel highlighted. A log axis because this account spans
// 3 to 2.4 million — on a linear scale 40 of the 41 dots would pile up at zero.
//
// Stays dir="ltr" in both languages: the axis runs low to high left-to-right in
// Arabic too, and mirroring it would make the numbers read backwards.

import React from 'react';

interface ReachStripProps {
    reaches: number[];
    highlight?: number;      // this reel's position on the same axis
    highlightLabel?: string;
}

const WIDTH = 520;
const HEIGHT = 64;
const PAD = 14;
const BASELINE = 30;

export function formatCount(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    return String(Math.round(value));
}

export default function ReachStrip({ reaches, highlight, highlightLabel }: ReachStripProps) {
    if (reaches.length === 0) return null;

    const sorted = [...reaches].sort((a, b) => a - b);
    const lo = Math.log10(Math.max(sorted[0], 1));
    const hi = Math.log10(Math.max(sorted[sorted.length - 1], 10));
    const span = hi - lo || 1;
    const x = (value: number) => PAD + ((Math.log10(Math.max(value, 1)) - lo) / span) * (WIDTH - PAD * 2);

    const median = sorted[Math.floor((sorted.length - 1) / 2)];

    return (
        <div dir="ltr">
        <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full h-16"
            role="img"
            aria-label={`Reach of ${reaches.length} reels, from ${formatCount(sorted[0])} to ${formatCount(sorted[sorted.length - 1])}`}
        >
            {/* recessive axis */}
            <line x1={PAD} y1={BASELINE} x2={WIDTH - PAD} y2={BASELINE} stroke="rgb(75,85,99)" strokeWidth="1" />

            {/* the account's reels — muted, with a surface ring so overlaps stay countable */}
            {sorted.map((value, index) => (
                <circle
                    key={`${value}-${index}`}
                    cx={x(value)}
                    cy={BASELINE}
                    r="4"
                    fill="rgb(107,114,128)"
                    stroke="rgb(31,41,55)"
                    strokeWidth="2"
                >
                    <title>{formatCount(value)} reach</title>
                </circle>
            ))}

            {/* this reel */}
            {highlight !== undefined && (
                <g>
                    <circle cx={x(highlight)} cy={BASELINE} r="6" fill="rgb(236,72,153)" stroke="rgb(31,41,55)" strokeWidth="2">
                        <title>{highlightLabel ?? `${formatCount(highlight)} reach`}</title>
                    </circle>
                    <path
                        d={`M ${x(highlight)} ${BASELINE - 11} l 0 -7`}
                        stroke="rgb(236,72,153)"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </g>
            )}

            {/* three labels only — never a number on every point */}
            <text x={PAD} y={HEIGHT - 6} fill="rgb(156,163,175)" fontSize="11" textAnchor="start">
                {formatCount(sorted[0])}
            </text>
            <text x={x(median)} y={HEIGHT - 6} fill="rgb(156,163,175)" fontSize="11" textAnchor="middle">
                {formatCount(median)}
            </text>
            <text x={WIDTH - PAD} y={HEIGHT - 6} fill="rgb(156,163,175)" fontSize="11" textAnchor="end">
                {formatCount(sorted[sorted.length - 1])}
            </text>
        </svg>
        </div>
    );
}
