'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { mapsApi, assignableApplications } from '@/services/api';
import type { MapBooth, AssignableApplication } from '@/services/api';
import { STATUS_BADGE_COLORS, STATUS_LABELS } from './mapTheme';

interface BoothPanelProps {
  booth: MapBooth;
  mapId: string;
  eventId: string;
  mapStatus: 'DRAFT' | 'PUBLISHED';
  role: string | undefined;
  onStatusChange: (boothId: string, status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED') => void;
  onAssign: (boothId: string, applicationId: string, force: boolean) => Promise<void>;
  onUnassign: (boothId: string) => void;
  onMoveStart: (boothId: string) => void;
  onMoveCancel: () => void;
  moveMode: string | null;
}

export default function BoothPanel({
  booth,
  mapId,
  eventId,
  mapStatus,
  role,
  onStatusChange,
  onAssign,
  onUnassign,
  onMoveStart,
  onMoveCancel,
  moveMode,
}: BoothPanelProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<AssignableApplication[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const isAdmin = role === 'ADMIN' || role === 'SYSTEM_ADMIN';
  const hasHolder = booth.status === 'SOLD' && booth.holder;

  const doSearch = useCallback(async (q: string) => {
    setSearch(q);
    if (!q.trim()) {
      setCandidates([]);
      return;
    }
    setSearching(true);
    try {
      const results = await mapsApi.assignableApplications(mapId, booth.id, q.trim());
      setCandidates(results);
    } catch {
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }, [mapId, booth.id]);

  const doAssign = async (applicationId: string) => {
    setAssigning(applicationId);
    setAssignError(null);
    try {
      await onAssign(booth.id, applicationId, force);
      setAssignOpen(false);
      setSearch('');
      setCandidates([]);
      setForce(false);
    } catch (err: any) {
      setAssignError(err?.message || 'Could not assign');
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-slate-700">
      {/* Status pill */}
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Status</p>
        <span
          className={`inline-block px-2 py-0.5 text-xs rounded-full ${
            STATUS_BADGE_COLORS[booth.status] || 'bg-gray-100 text-gray-700'
          }`}
        >
          {STATUS_LABELS[booth.status] || booth.status}
        </span>
      </div>

      {/* Holder info */}
      {hasHolder && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Assigned to</p>
          <Link
            href={`/admin/events/${eventId}/applications/${booth.holder.id}`}
            className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
          >
            {booth.holder.businessName || 'Unknown vendor'}
          </Link>
        </div>
      )}

      {/* Move mode indicator */}
      {moveMode === booth.id && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-900/20">
          <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
            Move mode: click another booth on the canvas
          </p>
          <button
            type="button"
            onClick={onMoveCancel}
            className="mt-1 text-xs font-medium text-red-600 hover:underline dark:text-red-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-1.5">
        {/* Assign / Unassign */}
        {!hasHolder && (booth.status === 'AVAILABLE' || booth.status === 'RESERVED') && (
          <button
            type="button"
            onClick={() => {
              setAssignOpen(true);
              setSearch('');
              setCandidates([]);
              setAssignError(null);
            }}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Assign
          </button>
        )}
        {hasHolder && (
          <button
            type="button"
            onClick={() => onUnassign(booth.id)}
            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:text-red-300"
          >
            Unassign
          </button>
        )}
        {/* Move — only for sold booths with a holder */}
        {hasHolder && (
          <button
            type="button"
            onClick={() => onMoveStart(booth.id)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            Move to…
          </button>
        )}
        {/* Reserve / Block / Make available — only for booths without a holder */}
        {!hasHolder && (
          <>
            {booth.status === 'AVAILABLE' && (
              <button
                type="button"
                onClick={() => onStatusChange(booth.id, 'RESERVED')}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                Reserve
              </button>
            )}
            {booth.status === 'AVAILABLE' && (
              <button
                type="button"
                onClick={() => onStatusChange(booth.id, 'BLOCKED')}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                Block
              </button>
            )}
            {booth.status === 'RESERVED' && (
              <button
                type="button"
                onClick={() => onStatusChange(booth.id, 'AVAILABLE')}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                Make available
              </button>
            )}
            {booth.status === 'BLOCKED' && (
              <button
                type="button"
                onClick={() => onStatusChange(booth.id, 'AVAILABLE')}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                Make available
              </button>
            )}
          </>
        )}
      </div>

      {/* Assign dialog */}
      {assignOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/40" onClick={() => setAssignOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Assign to {booth.label}</h3>

            <div className="mt-3">
              <input
                type="text"
                value={search}
                onChange={(e) => doSearch(e.target.value)}
                placeholder="Search by business name or contact…"
                autoFocus
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            {searching && <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Searching…</p>}

            {assignError && (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{assignError}</p>
            )}

            {candidates.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto">
                {candidates
                  .sort((a, b) => (a.tierMatch === b.tierMatch ? 0 : a.tierMatch ? -1 : 1))
                  .map((c) => (
                    <li
                      key={c.id}
                      className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                        c.tierMatch
                          ? 'bg-indigo-50 dark:bg-indigo-900/20'
                          : 'bg-gray-50 dark:bg-slate-700/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900 dark:text-white">
                          {c.businessName || c.contactName}
                        </p>
                        <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                          {c.contactName} · {c.email}
                          {c.tier && <span> · {c.tier.name} (${(c.tier.price / 100).toFixed(2)})</span>}
                          {!c.tierMatch && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400">(tier mismatch)</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => doAssign(c.id)}
                        disabled={assigning === c.id}
                        className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {assigning === c.id ? '…' : 'Assign'}
                      </button>
                    </li>
                  ))}
              </ul>
            )}

            {search.trim() && candidates.length === 0 && !searching && (
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">No matching applications found.</p>
            )}

            {!search.trim() && (
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Start typing to search approved applications.</p>
            )}

            {/* Force checkbox — ADMIN only */}
            {isAdmin && (
              <label className="mt-3 flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Force (allow tier mismatch)
              </label>
            )}

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setAssignOpen(false);
                  setSearch('');
                  setCandidates([]);
                  setAssignError(null);
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}