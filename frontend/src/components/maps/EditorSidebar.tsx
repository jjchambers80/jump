'use client';

import { formatPrice } from '../../lib/fees';
import React from 'react';
import type { MapBooth, MapTier, MapElement } from '@/services/api';
import { STATUS_BADGE_COLORS, STATUS_LABELS } from './mapTheme';
import MapLegend from './MapLegend';
import BoothPanel from './BoothPanel';

interface EditorSidebarProps {
  tabs: 'settings' | 'properties' | 'legend';
  onTabChange: (tab: 'settings' | 'properties' | 'legend') => void;
  // Settings tab
  name: string;
  onNameChange: (name: string) => void;
  width: number;
  height: number;
  onDimensionChange: (w: number, h: number) => void;
  unit: string;
  onUnitChange: (unit: string) => void;
  gridSize: number;
  onGridSizeChange: (gridSize: number) => void;
  underlayOpacity: number;
  onOpacityChange: (opacity: number) => void;
  // Properties tab — selected booth
  selectedBooth: MapBooth | null;
  tiers: MapTier[];
  onTierChange: (boothId: string, tierId: string | null) => void;
  onLabelChange: (boothId: string, label: string) => void;
  onKindChange: (boothId: string, kind: 'BOOTH' | 'TABLE') => void;
  onSizeChange: (boothId: string, w: number, h: number) => void;
  onRotationChange: (boothId: string, rotation: 0 | 90) => void;
  // Legend tab
  legendTiers: { id: string; name: string; price: number; swatch: number }[];
  selectedTierId: string | null;
  onTierSelect: (tierId: string | null) => void;
  // Booth panel (spec 014 phase 1 assignment)
  eventId: string;
  mapStatus: 'DRAFT' | 'PUBLISHED';
  role: string | undefined;
  onBoothAssign: (boothId: string, applicationId: string, force: boolean) => Promise<void>;
  onBoothUnassign: (boothId: string) => void;
  onBoothStatusChange: (boothId: string, status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED') => void;
  onBoothMoveStart: (boothId: string) => void;
  onBoothMoveCancel: () => void;
  moveMode: string | null;
}

export default function EditorSidebar({
  tabs,
  onTabChange,
  name,
  onNameChange,
  width,
  height,
  onDimensionChange,
  unit,
  onUnitChange,
  gridSize,
  onGridSizeChange,
  underlayOpacity,
  onOpacityChange,
  selectedBooth,
  tiers,
  onTierChange,
  onLabelChange,
  onKindChange,
  onSizeChange,
  onRotationChange,
  legendTiers,
  selectedTierId,
  onTierSelect,
  eventId,
  mapStatus,
  role,
  onBoothAssign,
  onBoothUnassign,
  onBoothStatusChange,
  onBoothMoveStart,
  onBoothMoveCancel,
  moveMode,
}: EditorSidebarProps) {
  const tabClass = (tab: string) =>
    `flex-1 px-3 py-2 text-xs font-medium rounded-t transition-colors ${
      tabs === tab
        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-500'
        : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
    }`;

  return (
    <div className="w-72 border-l border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-slate-700 px-2 pt-2">
        <button type="button" onClick={() => onTabChange('settings')} className={tabClass('settings')}>
          Settings
        </button>
        <button
          type="button"
          onClick={() => onTabChange('properties')}
          className={tabClass('properties')}
          disabled={!selectedBooth}
        >
          Properties
        </button>
        <button type="button" onClick={() => onTabChange('legend')} className={tabClass('legend')}>
          Legend
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Settings tab */}
        {tabs === 'settings' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Map name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Width
                </label>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => onDimensionChange(Number(e.target.value), height)}
                  min={1}
                  max={200}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Height
                </label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => onDimensionChange(width, Number(e.target.value))}
                  min={1}
                  max={200}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Unit
                </label>
                <select
                  value={unit}
                  onChange={(e) => onUnitChange(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                >
                  <option value="ft">Feet</option>
                  <option value="m">Meters</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Grid size
                </label>
                <input
                  type="number"
                  value={gridSize}
                  onChange={(e) => onGridSizeChange(Number(e.target.value))}
                  min={1}
                  max={100}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Underlay opacity ({underlayOpacity}%)
              </label>
              <input
                type="range"
                value={underlayOpacity}
                onChange={(e) => onOpacityChange(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full"
              />
            </div>
          </>
        )}

        {/* Properties tab */}
        {tabs === 'properties' && selectedBooth && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Label
              </label>
              <input
                type="text"
                value={selectedBooth.label}
                onChange={(e) => onLabelChange(selectedBooth.id, e.target.value)}
                maxLength={12}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Kind
              </label>
              <select
                value={selectedBooth.kind}
                onChange={(e) => onKindChange(selectedBooth.id, e.target.value as 'BOOTH' | 'TABLE')}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              >
                <option value="BOOTH">Booth</option>
                <option value="TABLE">Table</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Width
                </label>
                <input
                  type="number"
                  value={selectedBooth.w}
                  onChange={(e) => onSizeChange(selectedBooth.id, Number(e.target.value), selectedBooth.h)}
                  min={1}
                  max={50}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Height
                </label>
                <input
                  type="number"
                  value={selectedBooth.h}
                  onChange={(e) => onSizeChange(selectedBooth.id, selectedBooth.w, Number(e.target.value))}
                  min={1}
                  max={50}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Rotation
              </label>
              <div className="flex gap-2">
                {([0, 90] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onRotationChange(selectedBooth.id, r)}
                    className={`px-3 py-1 text-sm rounded border transition-colors ${
                      selectedBooth.rotation === r
                        ? 'bg-indigo-100 dark:bg-indigo-800 border-indigo-500 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300'
                    }`}
                  >
                    {r}°
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">
                Tier
              </label>
              <select
                value={selectedBooth.tierId || ''}
                onChange={(e) => onTierChange(selectedBooth.id, e.target.value || null)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              >
                <option value="">— No tier —</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({formatPrice(tier.price)})
                  </option>
                ))}
              </select>
            </div>

            {/* Booth panel — assignment operations */}
            <BoothPanel
              booth={selectedBooth}
              mapId={selectedBooth.mapId || ''}
              eventId={eventId}
              mapStatus={mapStatus}
              role={role}
              onStatusChange={onBoothStatusChange}
              onAssign={onBoothAssign}
              onUnassign={onBoothUnassign}
              onMoveStart={onBoothMoveStart}
              onMoveCancel={onBoothMoveCancel}
              moveMode={moveMode}
            />
          </>
        )}

        {tabs === 'properties' && !selectedBooth && (
          <p className="text-sm text-gray-500 dark:text-slate-400 italic">
            Select a booth or element to edit its properties.
          </p>
        )}

        {/* Legend tab */}
        {tabs === 'legend' && (
          <MapLegend
            tiers={legendTiers}
            showStates
            selectedTierId={selectedTierId}
            onTierSelect={onTierSelect}
          />
        )}
      </div>
    </div>
  );
}