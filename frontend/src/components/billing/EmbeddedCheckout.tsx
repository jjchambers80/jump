'use client';

// Stripe embedded Checkout (subscription mode) for Jump's own plan
// (spec 022 phase 2). Mounts the Stripe-hosted form inside our page so the
// subscribe screen keeps the two-column layout of the reference screenshot.
// Needs NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (Jump's account, not the org's).

import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe() {
  if (!PUBLISHABLE_KEY) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(PUBLISHABLE_KEY);
  return stripePromise;
}

export default function EmbeddedCheckout({ clientSecret }: { clientSecret: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let checkout: { mount: (el: HTMLElement) => void; destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const stripe = await getStripe();
      if (cancelled) return;
      if (!stripe) {
        setError('Payments are not configured (missing publishable key).');
        return;
      }
      try {
        checkout = await stripe.initEmbeddedCheckout({ clientSecret });
        if (cancelled || !mountRef.current) {
          checkout?.destroy();
          return;
        }
        checkout.mount(mountRef.current);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load the payment form.');
      }
    })();
    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [clientSecret]);

  if (error) return <p className="text-sm text-red-600" role="alert" data-testid="embedded-checkout-error">{error}</p>;
  return <div ref={mountRef} data-testid="embedded-checkout" className="min-h-[320px]" />;
}
