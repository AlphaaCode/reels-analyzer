import type { NextConfig } from "next";
import { MAX_VIDEO_SIZE_BYTES } from "./src/lib/constants";

const nextConfig: NextConfig = {
  // The password gate (src/proxy.ts) runs on every request, so Next buffers
  // request bodies for it and cuts them at 10 MB by default, which broke every
  // larger upload. Allow up to the upload route's own limit.
  experimental: { proxyClientMaxBodySize: MAX_VIDEO_SIZE_BYTES },
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
  // Since Next 16.4, `next dev` appends a managed block to AGENTS.md whenever it
  // detects an AI coding agent. AGENTS.md is hand-written here, so keep it that way.
  agentRules: false,
};

export default nextConfig;
