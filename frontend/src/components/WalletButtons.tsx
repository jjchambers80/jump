'use client';

// "Add to Apple Wallet" / "Add to Google Wallet" buttons for one ticket.
// The backend decides which providers are available (null link = hidden),
// and only VALID tickets ever carry links. Buttons are plain anchors to the
// backend's /wallet/* routes so they work from any page without JS state.
// Button styling follows the platforms' badge guidelines (black Apple pill,
// white Google pill with a dark outline).

import React from 'react';

export interface WalletLinks {
  apple: string | null;
  google: string | null;
}

interface WalletButtonsProps {
  wallet?: WalletLinks | null;
  /** Compact = smaller pills for lists; default = full-size for a ticket page. */
  size?: 'default' | 'compact';
  className?: string;
}

/** iOS devices show Apple first; everything else leads with Google. */
function isAppleDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M16.365 12.83c-.03-2.79 2.28-4.13 2.38-4.2-1.3-1.9-3.32-2.16-4.03-2.19-1.72-.17-3.35 1.01-4.22 1.01-.87 0-2.21-.99-3.64-.96-1.87.03-3.6 1.09-4.56 2.77-1.95 3.38-.5 8.38 1.4 11.12.93 1.34 2.03 2.85 3.48 2.8 1.4-.06 1.93-.9 3.62-.9 1.69 0 2.17.9 3.65.87 1.51-.03 2.46-1.36 3.38-2.71 1.07-1.56 1.5-3.07 1.53-3.15-.03-.01-2.93-1.12-2.96-4.46zM13.6 4.6c.77-.93 1.29-2.23 1.15-3.52-1.11.05-2.45.74-3.25 1.67-.71.82-1.34 2.14-1.17 3.4 1.24.1 2.5-.63 3.27-1.55z" />
    </svg>
  );
}

function GoogleWalletLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h9A2.5 2.5 0 0 1 17 6.5V8H3V6.5z" />
      <path fill="#34A853" d="M3 8h14v2.5H3z" />
      <path fill="#FBBC04" d="M3 10.5h14V13H3z" />
      <path fill="#EA4335" d="M3 13h14v1.5A2.5 2.5 0 0 1 14.5 17h-9A2.5 2.5 0 0 1 3 14.5V13z" />
      <path fill="#1A73E8" d="M8 9.5A3.5 3.5 0 0 1 11.5 6h6A3.5 3.5 0 0 1 21 9.5v7a3.5 3.5 0 0 1-3.5 3.5h-6A3.5 3.5 0 0 1 8 16.5v-7z" />
    </svg>
  );
}

export default function WalletButtons({ wallet, size = 'default', className = '' }: WalletButtonsProps) {
  const [appleFirst, setAppleFirst] = React.useState(false);
  React.useEffect(() => {
    setAppleFirst(isAppleDevice());
  }, []);

  if (!wallet || (!wallet.apple && !wallet.google)) return null;

  const pad = size === 'compact' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm';
  const icon = size === 'compact' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  const apple = wallet.apple ? (
    <a
      key="apple"
      href={wallet.apple}
      data-testid="add-to-apple-wallet"
      className={`inline-flex items-center gap-2 rounded-lg bg-black text-white font-semibold ${pad} hover:bg-neutral-800 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black dark:focus:ring-offset-slate-900`}
    >
      <AppleLogo className={icon} />
      Add to Apple Wallet
    </a>
  ) : null;

  const google = wallet.google ? (
    <a
      key="google"
      href={wallet.google}
      data-testid="add-to-google-wallet"
      className={`inline-flex items-center gap-2 rounded-lg bg-white text-[#1f1f1f] font-semibold border border-[#747775] ${pad} hover:bg-neutral-100 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#1A73E8] dark:focus:ring-offset-slate-900`}
    >
      <GoogleWalletLogo className={icon} />
      Add to Google Wallet
    </a>
  ) : null;

  const buttons = appleFirst ? [apple, google] : [google, apple];

  return (
    <div data-testid="wallet-buttons" className={`flex flex-wrap items-center gap-2 ${className}`}>
      {buttons}
    </div>
  );
}
