/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Users moved from the main admin menu to Settings › Users.
    return [
      { source: '/admin/users', destination: '/admin/settings/users', permanent: true },
      // Legacy legal paths (spec 023 LR-03). The targets are dark until
      // NEXT_PUBLIC_LEGAL_PAGES_ENABLED and counsel's text ship together.
      { source: '/terms', destination: '/legal/terms', permanent: true },
      { source: '/privacy', destination: '/legal/privacy', permanent: true },
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },
};

export default nextConfig;
