import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for container deploys (Hugging Face Spaces, Render, any VPS)
  output: 'standalone',
  // The report contract is read from disk at runtime (src/lib/prompt.ts,
  // src/lib/validate.ts); copy it into the standalone bundle the image ships
  outputFileTracingIncludes: {
    '/api/**/*': ['./prompts/**/*', './schema/**/*', './assets/fonts/**/*'],
  },
  // All next/image uses are tiny local PNG icons + one avatar. The optimizer
  // re-fetches sources without credentials, so the APP_PASSWORD gate 401s it
  // (icons broke on Render) — and it burns CPU the free instance doesn't have.
  images: { unoptimized: true },
};

export default nextConfig;
