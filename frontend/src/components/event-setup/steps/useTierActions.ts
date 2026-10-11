'use client';

// Tier writes for the wizard's Tickets step (spec 050 §11.5: dialog items save
// on their own). Each one goes straight to the price-tier routes, updates the
// saved row and refreshes the preview. Form ↔ API mapping is the shared
// components/events/tierForm.ts, the same the event editor uses.

import { useState } from 'react';
import api from '@/services/api';
import type { OverviewTier } from '@/lib/eventOverview';
import {
  duplicateTierForm, tierCreateBody, tierErrors, tierPatchBody, tierToForm, type TierFormInput,
} from '@/components/events/tierForm';
import type { SavedRowProps } from './types';

const message = (err: unknown, fallback: string) => (err as Error)?.message || fallback;

export function useTierActions({ orgId, saved, setSaved, zone, refreshPreview }: SavedRowProps) {
  const base = `/organizations/${orgId}/events/${encodeURIComponent(saved.id)}/price-tiers`;
  const tiers = saved.tiers ?? [];
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (update: (list: OverviewTier[]) => OverviewTier[], text: string) => {
    setSaved((row) => {
      if (!row) return row;
      const list = update(row.tiers ?? []);
      return { ...row, tiers: list, tierCount: list.length };
    });
    setError(null);
    setNotice(text);
    refreshPreview();
  };

  /** Saves the dialog's tier; resolves with the problems to show, [] when saved. */
  async function save(draft: TierFormInput): Promise<string[]> {
    const problems = tierErrors(draft, zone);
    if (problems.length) return problems;
    try {
      if (draft.isNew) {
        const created = await api.post<OverviewTier>(base, tierCreateBody(draft, zone));
        commit((list) => [...list, created], `Added ${created.name}`);
        return [];
      }
      const orig = tiers.find((t) => t.id === draft.key);
      const body = orig ? tierPatchBody(draft, orig, zone) : {};
      if (!orig || !Object.keys(body).length) return [];
      const updated = await api.patch<OverviewTier>(`${base}/${encodeURIComponent(orig.id)}`, body);
      commit((list) => list.map((t) => (t.id === orig.id ? { ...t, ...updated } : t)), `Saved ${updated.name}`);
      return [];
    } catch (err) {
      return [message(err, "Couldn't save the tier")];
    }
  }

  async function duplicate(tier: OverviewTier) {
    try {
      const copy = duplicateTierForm(tierToForm(tier, zone));
      const created = await api.post<OverviewTier>(base, tierCreateBody(copy, zone));
      commit((list) => [...list, created], `Added ${created.name}`);
    } catch (err) {
      setError(message(err, "Couldn't duplicate the tier"));
    }
  }

  async function remove(tier: OverviewTier) {
    if (!window.confirm(`Remove the tier "${tier.name}"?`)) return;
    try {
      await api.delete(`${base}/${encodeURIComponent(tier.id)}`);
      commit((list) => list.filter((t) => t.id !== tier.id), `Removed ${tier.name}`);
    } catch (err) {
      setError(message(err, "Couldn't remove the tier"));
    }
  }

  async function toggleActive(tier: OverviewTier) {
    const action = tier.isActive ? 'deactivate' : 'activate';
    try {
      const updated = await api.post<OverviewTier>(`${base}/${encodeURIComponent(tier.id)}/${action}`, {});
      commit((list) => list.map((t) => (t.id === tier.id ? { ...t, ...updated } : t)), `${tier.name} is ${updated.isActive ? 'on sale' : 'off sale'}`);
    } catch (err) {
      setError(message(err, "Couldn't change the tier"));
    }
  }

  async function move(index: number, direction: 'up' | 'down') {
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= tiers.length) return;
    const order = tiers.map((t) => t.id);
    [order[index], order[swap]] = [order[swap], order[index]];
    try {
      await api.post(`${base}/reorder`, { tierIds: order });
      commit((list) => order.map((id) => list.find((t) => t.id === id)!).filter(Boolean), `Moved ${tiers[index].name} ${direction}`);
    } catch (err) {
      setError(message(err, "Couldn't reorder the tiers"));
    }
  }

  return { tiers, notice, error, save, duplicate, remove, toggleActive, move };
}
