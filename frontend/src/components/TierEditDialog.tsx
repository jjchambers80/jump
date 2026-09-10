'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface TierFormData {
  key: string;
  isNew?: boolean;
  name: string;
  description: string;
  price: string;
  quantityTotal: string;
  quantitySold?: number;
  quantityReserved?: number;
  minPerOrder: string;
  maxPerOrder: string;
  saleStartDate: string;
  saleEndDate: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'HIDDEN';
  isRefundable: boolean;
  isActive?: boolean;
}

interface TierCardProps {
  tier: TierFormData;
  index: number;
  total: number;
  canDelete: boolean;
  deleteBlockedReason?: string;
  onEdit: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDelete: () => void;
}

export function TierCard({
  tier,
  index,
  total,
  canDelete,
  deleteBlockedReason,
  onEdit,
  onMove,
  onDelete,
}: TierCardProps) {
  const priceDisplay = tier.price
    ? Number(tier.price) === 0
      ? 'Free'
      : `$${Number(tier.price).toFixed(2)}`
    : '—';

  return (
    <div
      className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-4 flex items-center gap-4 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-600 transition-colors"
      onClick={onEdit}
    >
      {/* Reorder buttons */}
      <div className="flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onMove('up')}
          disabled={index === 0}
          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 disabled:opacity-30 text-xs"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove('down')}
          disabled={index === total - 1}
          className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 disabled:opacity-30 text-xs"
          title="Move down"
        >
          ↓
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {tier.name || 'Untitled Tier'}
          </h3>
          {tier.isNew && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 shrink-0">
              new
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400">
          <span className="font-medium text-gray-900 dark:text-white text-sm">{priceDisplay}</span>
          <span>
            {tier.quantityTotal ? `${tier.quantityTotal} qty` : 'No qty set'}
            {tier.quantitySold != null && tier.quantitySold > 0 && (
              <span className="text-gray-400 dark:text-slate-500"> ({tier.quantitySold} sold)</span>
            )}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
            tier.visibility === 'PUBLIC'
              ? 'bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400'
              : tier.visibility === 'PRIVATE'
              ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
            {tier.visibility.charAt(0) + tier.visibility.slice(1).toLowerCase()}
          </span>
          {tier.isRefundable && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400">
              Refundable
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-gray-300 dark:border-slate-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          Edit
        </button>
        <div className="relative group">
          <button
            type="button"
            onClick={() => canDelete && onDelete()}
            disabled={!canDelete}
            className={`p-1.5 rounded ${
              canDelete
                ? 'text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                : 'text-gray-400 cursor-not-allowed opacity-40'
            }`}
            title={canDelete ? 'Remove tier' : ''}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {!canDelete && deleteBlockedReason && (
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
              {deleteBlockedReason}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TierEditDialogProps {
  tier: TierFormData;
  index: number;
  onSave: (updated: TierFormData) => void;
  onCancel: () => void;
}

export function TierEditDialog({ tier, index, onSave, onCancel }: TierEditDialogProps) {
  const [draft, setDraft] = useState<TierFormData>({ ...tier });
  const overlayRef = useRef<HTMLDivElement>(null);

  const update = (field: keyof TierFormData, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const inputClass =
    'block w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel(); }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-800 w-full sm:max-w-lg sm:rounded-lg rounded-t-xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {tier.isNew ? `New Tier ${index + 1}` : `Edit Tier ${index + 1}`}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className={labelClass}>Tier Name *</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="e.g. General Admission"
              className={inputClass}
              required
              autoFocus
            />
          </div>

          <div>
            <label className={labelClass}>Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => update('description', e.target.value)}
              placeholder="Brief description (optional)"
              maxLength={500}
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Price ($) *</label>
              <input
                type="number"
                value={draft.price}
                onChange={(e) => update('price', e.target.value)}
                placeholder="0.00"
                min={0}
                step="0.01"
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>Quantity *</label>
              <input
                type="number"
                value={draft.quantityTotal}
                onChange={(e) => update('quantityTotal', e.target.value)}
                placeholder="100"
                min={draft.isNew ? 1 : (draft.quantitySold || 0) + (draft.quantityReserved || 0)}
                className={inputClass}
                required
              />
              {!draft.isNew && ((draft.quantitySold || 0) > 0 || (draft.quantityReserved || 0) > 0) && (
                <p className="mt-0.5 text-xs text-gray-400 dark:text-slate-500">
                  Min: {(draft.quantitySold || 0) + (draft.quantityReserved || 0)} (sold + reserved)
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Min / Order</label>
              <input
                type="number"
                value={draft.minPerOrder}
                onChange={(e) => update('minPerOrder', e.target.value)}
                min={1}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Max / Order</label>
              <input
                type="number"
                value={draft.maxPerOrder}
                onChange={(e) => update('maxPerOrder', e.target.value)}
                min={1}
                className={inputClass}
              />
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Sale Start</label>
                <input
                  type="datetime-local"
                  value={draft.saleStartDate}
                  onChange={(e) => update('saleStartDate', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Sale End</label>
                <input
                  type="datetime-local"
                  value={draft.saleEndDate}
                  onChange={(e) => update('saleEndDate', e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Visibility</label>
              <select
                value={draft.visibility}
                onChange={(e) => update('visibility', e.target.value)}
                className={inputClass}
              >
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.isRefundable}
                  onChange={(e) => update('isRefundable', e.target.checked)}
                  className="rounded border-gray-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-gray-700 dark:text-slate-300">Refundable</span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 px-6 py-4 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
