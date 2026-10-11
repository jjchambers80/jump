'use client';

// Data for the lineup editor (spec 050 §7.6, card 050-Q): the event's guest
// rows and every write, each followed by a preview refresh (the revision bump).

import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import type { AdminEventGuest } from '@/lib/eventGuests';

export interface GuestInput {
  name: string;
  role: string | null;
  bio: string | null;
  links: Record<string, string> | null;
  isVisible?: boolean;
}

export function useGuestLineup(orgId: string, eventId: string, refreshPreview: () => void) {
  const base = `/organizations/${orgId}/events/${eventId}/guests`;
  const [guests, setGuests] = useState<AdminEventGuest[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setGuests((await api.get<{ data: AdminEventGuest[] }>(base)).data);
    } catch {
      setLoadError(true);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (row: AdminEventGuest) => setGuests((list) => (list ?? []).map((g) => (g.id === row.id ? row : g)));

  const done = <T,>(value: T) => {
    refreshPreview();
    return value;
  };

  return {
    guests,
    loadError,
    reload: load,
    /** Create or update, then upload / remove the image. Returns the saved row. */
    /**
     * `onCreated` fires as soon as a new row exists, before the photo upload:
     * the caller keeps its id so a retry after a failed upload updates that
     * row instead of creating a second one.
     */
    save: async (id: string | null, input: GuestInput, image: { file?: File | null; remove?: boolean }, onCreated?: (row: AdminEventGuest) => void) => {
      let row = id ? await api.patch<AdminEventGuest>(`${base}/${id}`, input) : await api.post<AdminEventGuest>(base, input);
      if (!id) {
        const created = row;
        setGuests((list) => [...(list ?? []), created]);
        onCreated?.(created);
      }
      if (image.file) {
        const form = new FormData();
        form.append('logo', image.file);
        row = await api.upload<AdminEventGuest>(`${base}/${row.id}/image`, form);
      } else if (image.remove && row.imageUrl) {
        row = await api.delete<AdminEventGuest>(`${base}/${row.id}/image`);
      }
      setGuests((list) => (list ?? []).map((g) => (g.id === row.id ? row : g)));
      return done(row);
    },
    setVisible: async (guest: AdminEventGuest, isVisible: boolean) => {
      replace({ ...guest, isVisible });
      try {
        replace(await api.patch<AdminEventGuest>(`${base}/${guest.id}`, { isVisible }));
        done(null);
      } catch (err) {
        replace(guest);
        throw err;
      }
    },
    move: async (index: number, delta: -1 | 1) => {
      const list = [...(guests ?? [])];
      const to = index + delta;
      if (to < 0 || to >= list.length) return;
      [list[index], list[to]] = [list[to], list[index]];
      const before = guests;
      setGuests(list);
      try {
        setGuests((await api.post<{ data: AdminEventGuest[] }>(`${base}/reorder`, { ids: list.map((g) => g.id) })).data);
        done(null);
      } catch (err) {
        setGuests(before);
        throw err;
      }
    },
    remove: async (guest: AdminEventGuest) => {
      await api.delete(`${base}/${guest.id}`);
      setGuests((list) => (list ?? []).filter((g) => g.id !== guest.id));
      done(null);
    },
  };
}
