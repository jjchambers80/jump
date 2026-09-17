'use client';

// Stripe Connect actions shared by the provider card and the payouts page
// (spec 010 phase 2): start/continue onboarding (full-page redirect to the
// Stripe-hosted Account Link), open the Express dashboard (new tab), and pull
// the account state from Stripe. One in-flight action at a time.

import { useCallback, useState } from 'react';
import type { ConnectState } from './types';
import { describeError, usePaymentsApi } from './usePaymentsApi';

export type ConnectAction = 'onboard' | 'login' | 'sync' | null;

export function useConnectActions(onConnect: (next: ConnectState) => void, onError: (message: string) => void) {
  const api = usePaymentsApi();
  const [busy, setBusy] = useState<ConnectAction>(null);

  const onboard = useCallback(async () => {
    if (busy) return;
    setBusy('onboard');
    try {
      const { url } = await api.onboard();
      window.location.assign(url);
      // Keep the button disabled while the browser navigates away.
    } catch (err) {
      onError(describeError(err, 'Could not start Stripe onboarding'));
      setBusy(null);
    }
  }, [api, busy, onError]);

  const openDashboard = useCallback(async () => {
    if (busy) return;
    setBusy('login');
    try {
      const { url } = await api.loginLink();
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      onError(describeError(err, 'Could not open the Stripe dashboard'));
    } finally {
      setBusy(null);
    }
  }, [api, busy, onError]);

  const sync = useCallback(async () => {
    if (busy) return null;
    setBusy('sync');
    try {
      const { connect } = await api.sync();
      onConnect(connect);
      return connect;
    } catch (err) {
      onError(describeError(err, 'Could not refresh the payout status'));
      return null;
    } finally {
      setBusy(null);
    }
  }, [api, busy, onConnect, onError]);

  return { busy, onboard, openDashboard, sync };
}
