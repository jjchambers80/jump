/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Users moved from the main admin menu to Settings › Users.
    return [
      { source: '/admin/users', destination: '/admin/settings/users', permanent: true },
      // Settings › Payments › Payouts became "Payout bank account"; Finance › Payouts is the history page
      { source: '/admin/settings/payments/payouts', destination: '/admin/settings/payments/payout-bank-account', permanent: true },
      // Legacy legal paths (spec 023 LR-03). The targets are dark until
      // NEXT_PUBLIC_LEGAL_PAGES_ENABLED and counsel's text ship together.
      { source: '/terms', destination: '/legal/terms', permanent: true },
      { source: '/privacy', destination: '/legal/privacy', permanent: true },
    ];
  },
  async rewrites() {
    // RFC 9116 security.txt: the route handler lives at /well-known/security.txt
    // because Next.js App Router ignores segments starting with `.`.
    return [
      { source: '/.well-known/security.txt', destination: '/well-known/security.txt' },
    ];
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },
};

export default nextConfig;
