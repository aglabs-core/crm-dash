import type {NextConfig} from 'next';
import { execFileSync } from 'node:child_process';

function buildCommit(): string {
  const configured = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (configured && /^[a-f0-9]{40}$/.test(configured)) return configured;
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 3000 }).trim(); } catch { return ''; }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { CRM_BUILD_COMMIT: buildCommit() },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
      {
        protocol: 'https',
        hostname: 'uunyxyvfajrorqnatifn.supabase.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'udcsokdtdqqdnoqozbxh.supabase.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
