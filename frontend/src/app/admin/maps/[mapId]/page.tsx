'use client';

import React, { useState, useCallback, Suspense, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useOrg } from '@/components/OrgContext';
import MapCanvas from '@/components/maps/MapCanvas';
import MapLegend from '@/components/maps/MapLegend';
import EditorToolbar from '@/components/maps/EditorToolbar';
import EditorSidebar from '@/components/maps/EditorSidebar';
import { useMapEditor, type EditorTool } from '@/components/maps/useMapEditor';
import { mapsApi } from '@/services/api';
import { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import type { MapBooth, MapElement } from '@/services/api';
import { snapToGrid, findAlignmentGuides } from '@/components/maps/layoutOps';
import { generateAutoNumberLabels, defaultBoothLabel } from '@/components/maps/boothLabels';
import {
  ArrowLeft,
  AlertTriangle,
  Loader2,
  ExternalLink,
} from 'lucide-react';

function BuilderContent() {
  const params = useParams();
  const router = useRouter();
  const mapId = params.mapId as string;
  const { selectedOrgId } = useOrg();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const {
    state,
    tiers,
    loading,
    error,
    saving,
    saveError,
    dirty,
    selectedIds,
    activeTool,
    zoom,
    setSelectedIds,
    setActiveTool,
    setZoom,
    updateState,
    updateBooths,
    updateElements,
    addBooth,
    removeSelected,
    duplicateSelected,
    undo,
    redo,
    doSave,
    publish,
    unpublish,
  } = useMapEditor(mapId);

  const [sidebarTab, setSidebarTab] = useState<'settings' | 'properties' | 'legend'>('settings');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [selectedBooth, setSelectedBooth] = useState<MapBooth | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const [guides, setGuides] = useState<{ axis: 'x' | 'y'; pos: number }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  // Booth move mode
  const [moveMode, setMoveMode] = useState<string | null>(null);

  // Reset selected booth when selectedIds changes
  useEffect(() => {
    if (selectedIds.size === 1 && state) {
      const boothId = [...selectedIds][0];
      const booth = state.booths.find((b) => b.id === boothId);
      setSelectedBooth(booth || null);
    } else if (selectedIds.size !== 1) {
      setSelectedBooth(null);
    }
  }, [selectedIds, state?.booths]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        duplicateSelected();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        removeSelected();
      }
      if (e.key === 'r' && selectedIds.size === 1) {
        const booth = state?.booths.find((b) => selectedIds.has(b.id));
        if (booth) {
          const newRotation = booth.rotation === 0 ? 90 : 0;
          onRotationChange(booth.id, newRotation as 0 | 90);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, duplicateSelected, removeSelected, selectedIds, state]);

  const handleCanvasClick = useCallback(
    (id: string, e?: React.MouseEvent | React.KeyboardEvent) => {
      // If in move mode, attempt the move
      if (moveMode && id !== moveMode) {
        doMove(moveMode, id);
        return;
      }
      if (selectedIds.has(id)) {
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set([id]));
      }
    },
    [selectedIds, setSelectedIds, moveMode]
  );

  // ─── Booth assignment API calls ──────────────────────────────────

  const doAssign = useCallback(async (boothId: string, applicationId: string, force: boolean) => {
    if (!state) return;
    try {
      const result = await mapsApi.assignBooth(mapId, boothId, applicationId, force);
      // Reload the full map to get fresh state
      const fresh = await mapsApi.get(mapId);
      updateBooths(fresh.booths);
      const update: any = {};
      update.status = fresh.status;
      update.booths = fresh.booths;
      updateState(update);
    } catch (err: any) {
      throw err;
    }
  }, [state, mapId, updateBooths, updateState]);

  const doUnassign = useCallback(async (boothId: string) => {
    try {
      const result = await mapsApi.unassignBooth(mapId, boothId);
      const fresh = await mapsApi.get(mapId);
      updateBooths(fresh.booths);
    } catch (err: any) {
      // Show error
      console.error('Unassign failed', err);
    }
  }, [mapId, updateBooths]);

  const doStatusChange = useCallback(async (boothId: string, status: 'AVAILABLE' | 'RESERVED' | 'BLOCKED') => {
    try {
      const result = await mapsApi.setBoothStatus(mapId, boothId, status);
      const fresh = await mapsApi.get(mapId);
      updateBooths(fresh.booths);
    } catch (err: any) {
      console.error('Status change failed', err);
    }
  }, [mapId, updateBooths]);

  const doMove = useCallback(async (fromBoothId: string, toBoothId: string) => {
    try {
      const result = await mapsApi.moveBooth(mapId, fromBoothId, toBoothId);
      const fresh = await mapsApi.get(mapId);
      updateBooths(fresh.booths);
      setMoveMode(null);
    } catch (err: any) {
      console.error('Move failed', err);
      setMoveMode(null);
    }
  }, [mapId, updateBooths]);

  // ─── End booth assignment API ────────────────────────────────────

  const handleCanvasPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Place new booths/table/markers on double-click or click on empty space with tool active
    },
    []
  );

  // Zoom controls
  const zoomIn = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.zoomIn(0.2);
    }
  }, []);

  const zoomOut = useCallback(() => {
    if (transformRef.current) {
      transformRef.current.zoomOut(0.2);
    }
  }, []);

  const handleZoomChange = useCallback((scale: number) => {
    setZoom(scale);
  }, []);

  // Properties tab changes
  const onTierChange = useCallback(
    (boothId: string, tierId: string | null) => {
      if (!state) return;
      const newBooths = state.booths.map((b) => (b.id === boothId ? { ...b, tierId } : b));
      updateBooths(newBooths);
      setSelectedBooth(newBooths.find((b) => b.id === boothId) || null);
    },
    [state, updateBooths]
  );

  const onLabelChange = useCallback(
    (boothId: string, label: string) => {
      if (!state) return;
      const newBooths = state.booths.map((b) => (b.id === boothId ? { ...b, label } : b));
      updateBooths(newBooths);
    },
    [state, updateBooths]
  );

  const onKindChange = useCallback(
    (boothId: string, kind: 'BOOTH' | 'TABLE') => {
      if (!state) return;
      const newBooths = state.booths.map((b) => (b.id === boothId ? { ...b, kind } : b));
      updateBooths(newBooths);
    },
    [state, updateBooths]
  );

  const onSizeChange = useCallback(
    (boothId: string, w: number, h: number) => {
      if (!state) return;
      const clampedW = Math.max(1, Math.min(50, w));
      const clampedH = Math.max(1, Math.min(50, h));
      const newBooths = state.booths.map((b) => (b.id === boothId ? { ...b, w: clampedW, h: clampedH } : b));
      updateBooths(newBooths);
    },
    [state, updateBooths]
  );

  const onRotationChange = useCallback(
    (boothId: string, rotation: 0 | 90) => {
      if (!state) return;
      const newBooths = state.booths.map((b) => (b.id === boothId ? { ...b, rotation } : b));
      updateBooths(newBooths);
      setSelectedBooth(newBooths.find((b) => b.id === boothId) || null);
    },
    [state, updateBooths]
  );

  const handlePublish = useCallback(async () => {
    setPublishError(null);
    try {
      await doSave();
      await publish();
      setShowPublishDialog(false);
    } catch (err: any) {
      setPublishError(err?.message || 'Publish failed');
    }
  }, [doSave, publish]);

  const handleUnpublish = useCallback(async () => {
    try {
      await unpublish();
    } catch (err: any) {
      setPublishError(err?.message || 'Unpublish failed');
    }
  }, [unpublish]);

  // Legend tiers
  const legendTiers = tiers.map((t, i) => ({
    id: t.id,
    name: t.name,
    price: t.price,
    swatch: i % 6,
  }));

  // Filter booths by selected tier in legend
  const filteredBooths = state?.booths || [];

  // Session-based eventId from the first tier's form, or fallback URL param
  const eventId = state?.booths?.[0]?.mapId ? (mapId) : '';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        <span className="ml-2 text-gray-500 dark:text-slate-400">Loading map…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
          <p className="text-red-500 font-medium">{error}</p>
          <button
            onClick={() => router.push('/admin/maps')}
            className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            Back to maps
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
        <button
          onClick={() => router.push('/admin/maps')}
          className="p-1 rounded text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700"
          aria-label="Back to maps"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
          {state.name}
        </h1>
        <span
          className={`px-2 py-0.5 text-xs rounded-full ${
            state.status === 'PUBLISHED'
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
          }`}
        >
          {state.status === 'PUBLISHED' ? 'Published' : 'Draft'}
        </span>
        <div className="flex-1" />
        <span className="text-xs text-gray-500 dark:text-slate-400">
          {state.booths.length} booth{state.booths.length !== 1 ? 's' : ''} · {state.width}×{state.height} {state.unit}
        </span>
      </div>

      {/* Toolbar */}
      <EditorToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onUndo={undo}
        onRedo={redo}
        canUndo={true}
        canRedo={true}
        onDuplicate={duplicateSelected}
        onDelete={removeSelected}
        onSave={doSave}
        onPublish={() => setShowPublishDialog(true)}
        onUnpublish={handleUnpublish}
        saving={saving}
        dirty={dirty}
        status={state.status}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
      />

      {/* Save error toast */}
      {saveError && (
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {saveError}
          <button
            onClick={() => doSave()}
            className="ml-auto text-red-600 dark:text-red-400 underline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main area: canvas + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative bg-gray-50 dark:bg-slate-900">
          <MapCanvas
            width={state.width}
            height={state.height}
            gridSize={state.gridSize}
            unit={state.unit}
            elements={state.elements}
            booths={filteredBooths}
            interactive
            selectedIds={selectedIds}
            onSelect={handleCanvasClick}
            onPointerDown={handleCanvasPointerDown}
            onZoomChange={handleZoomChange}
            transformRef={transformRef}
            guides={guides}
            showGrid
          />
        </div>

        {/* Right sidebar */}
        <EditorSidebar
          tabs={sidebarTab}
          onTabChange={setSidebarTab}
          name={state.name}
          onNameChange={(name) => updateState({ name })}
          width={state.width}
          height={state.height}
          onDimensionChange={(w, h) => updateState({ width: w, height: h })}
          unit={state.unit}
          onUnitChange={(unit) => updateState({ unit })}
          gridSize={state.gridSize}
          onGridSizeChange={(gs) => updateState({ gridSize: gs })}
          underlayOpacity={state.underlayOpacity}
          onOpacityChange={(op) => updateState({ underlayOpacity: op })}
          selectedBooth={selectedBooth}
          tiers={tiers}
          onTierChange={onTierChange}
          onLabelChange={onLabelChange}
          onKindChange={onKindChange}
          onSizeChange={onSizeChange}
          onRotationChange={onRotationChange}
          legendTiers={legendTiers}
          selectedTierId={null}
          onTierSelect={() => {}}
          // Booth panel props
          eventId={state.eventId}
          mapStatus={state.status}
          role={role}
          onBoothAssign={doAssign}
          onBoothUnassign={doUnassign}
          onBoothStatusChange={doStatusChange}
          onBoothMoveStart={(boothId) => setMoveMode(boothId)}
          onBoothMoveCancel={() => setMoveMode(null)}
          moveMode={moveMode}
        />
      </div>

      {/* Publish confirm dialog */}
      {showPublishDialog && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Publish floor map
            </h2>

            <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
              Publishing will set tier quantities to match booth counts. This action affects
              application capacity — review the tiers below before continuing.
            </p>

            {/* Tier list with new quantities */}
            <div className="space-y-2 mb-4">
              {tiers
                .filter((t) => filteredBooths.some((b) => b.tierId === t.id))
                .map((tier) => {
                  const boothCount = filteredBooths.filter((b) => b.tierId === tier.id).length;
                  return (
                    <div
                      key={tier.id}
                      className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-slate-700 rounded text-sm"
                    >
                      <div>
                        <span className="text-gray-900 dark:text-white font-medium">
                          {tier.name}
                        </span>
                        <span className="text-gray-500 dark:text-slate-400 ml-2">
                          {boothCount} booth{boothCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span
                        className={`text-xs ${
                          tier.mapBound
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : 'text-gray-500'
                        }`}
                      >
                        {tier.mapBound ? 'Map-bound' : 'Set as map-bound'}
                      </span>
                    </div>
                  );
                })}
            </div>

            {publishError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {publishError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPublishDialog(false);
                  setPublishError(null);
                }}
                className="px-4 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={saving}
                className="px-4 py-2 text-sm bg-green-600 text-white hover:bg-green-700 rounded transition-colors disabled:opacity-50"
              >
                {saving ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Published link */}
      {state.status === 'PUBLISHED' && (
        <div className="px-4 py-1.5 bg-green-50 dark:bg-green-900/10 border-t border-green-200 dark:border-green-800/30 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          <ExternalLink className="w-3 h-3" />
          Published — view on the event page when the map is open.
        </div>
      )}
    </div>
  );
}

export default function MapBuilderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      }
    >
      <BuilderContent />
    </Suspense>
  );
}