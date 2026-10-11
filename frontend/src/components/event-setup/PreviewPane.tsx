'use client';

// Live preview (spec 050 §8.3, §11.4). One iframe for every width: from `lg`
// it is the right-hand pane; below, the same element becomes a full-screen
// sheet behind the header's eye button (focus trapped, Escape closes, focus
// returns) and is `inert` + hidden while closed, so the frame keeps its state.
// Phone = a 390 × 844 viewport; Desktop = 1280 wide scaled to the pane.

import { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog';
import { usePreviewChannel } from './usePreviewChannel';
import type { PreviewMessage } from './previewMessages';

type Device = 'phone' | 'desktop';
const SIZES: Record<Device, { width: number; height: number | null }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: null },
};

function useSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export default function PreviewPane({
  message,
  isDesktop,
  open,
  onClose,
}: {
  message: PreviewMessage;
  /** ≥ lg: inline pane. Below: a sheet shown while `open`. */
  isDesktop: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [device, setDevice] = useState<Device>('phone');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const ready = usePreviewChannel(frameRef, message);
  const stage = useSize(stageRef);
  const sheet = !isDesktop;
  const panelRef = useDialog<HTMLElement>(sheet && open, onClose);

  // The sheet keeps its iframe mounted while closed: inert keeps it out of Tab
  // order. A layout effect, so it lifts before useDialog moves focus in.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el) el.inert = sheet && !open;
  }, [panelRef, sheet, open]);

  const { width, height } = SIZES[device];
  const scale = stage.width
    ? Math.min(1, (stage.width - 16) / width, height ? (stage.height - 16) / height : 1)
    : 1;
  const frameHeight = height ?? (stage.height ? stage.height / scale : 800);

  return (
    <section
      ref={panelRef}
      aria-label="Live preview of the event page"
      {...(sheet ? { role: 'dialog', 'aria-modal': true, 'aria-hidden': !open || undefined } : {})}
      className={
        sheet
          ? `${open ? 'fixed' : 'hidden'} inset-0 z-50 flex flex-col bg-gray-50 dark:bg-slate-900 motion-safe:animate-fade-in`
          : 'flex min-h-0 flex-1 flex-col border-l border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900'
      }
    >
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-medium text-gray-700 dark:text-slate-300">Preview</h2>
        {/* Native radios: arrow keys move the choice, one Tab stop (§8.3: a radio group, not a switch). */}
        <fieldset className="inline-flex rounded-md border border-gray-300 p-0.5 dark:border-slate-600">
          <legend className="sr-only">Preview size</legend>
          {(['phone', 'desktop'] as Device[]).map((value) => (
            <label key={value} className="relative">
              <input
                type="radio"
                name="setup-preview-size"
                value={value}
                checked={device === value}
                onChange={() => setDevice(value)}
                className="peer sr-only"
              />
              <span className="flex min-h-11 cursor-pointer items-center rounded px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 peer-checked:bg-gray-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:peer-checked:bg-slate-100 dark:peer-checked:text-slate-900 sm:min-h-9">
                {value === 'phone' ? 'Phone' : 'Desktop'}
              </span>
            </label>
          ))}
        </fieldset>
        {sheet && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 justify-center overflow-hidden p-2">
        {!ready && <div aria-hidden className="absolute inset-4 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-800" />}
        <div style={{ width: width * scale, height: frameHeight * scale }} className="relative shrink-0">
          <iframe
            ref={frameRef}
            src="/admin/events/preview-frame"
            title="Event page preview"
            style={{ width, height: frameHeight, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            className={`absolute left-0 top-0 rounded-md border border-gray-300 bg-white dark:border-slate-700 ${ready ? '' : 'opacity-0'}`}
          />
        </div>
      </div>
    </section>
  );
}
