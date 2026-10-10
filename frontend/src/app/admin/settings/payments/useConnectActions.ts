'use client';

// Stripe Connect actions shared by the provider card and the payouts page
// (spec 010 phase 2, spec 047 S1): create the organization's own Stripe account
// and start/continue onboarding (full-page redirect to the Stripe-hosted
// Account Link), connect an existing account with OAuth (full-page redirect to
// Stripe, back with ?code=&state=), finish that connection, and pull the
// account state from Stripe. The Stripe dashboard is a plain link
// (`account.dashboardUrl`). One in-flight action at a time.

import { useCallback, useState } from 'react';
import type { ConnectState } from './types';
import { describeError, usePaymentsApi } from './usePaymentsApi';

export type ConnectAction = 'onboard' | 'oauth' | 'sync' | null;

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

  const connectExisting = useCallback(async () => {
    if (busy) return;
    setBusy('oauth');
    try {
      const { url } = await api.oauth();
      window.location.assign(url);
    } catch (err) {
      onError(describeError(err, 'Could not start connecting your Stripe account'));
      setBusy(null);
    }
  }, [api, busy, onError]);

  const completeOAuth = useCallback(
    async (code: string, state: string) => {
      setBusy('oauth');
      try {
        const { connect } = await api.completeOAuth({ code, state });
        onConnect(connect);
        return connect;
      } catch (err) {
        onError(describeError(err, 'Could not connect your Stripe account'));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [api, onConnect, onError]
  );

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

  return { busy, onboard, connectExisting, completeOAuth, sync };
}
