'use client';

// Live preview (spec 050 §8.3, §11.4). One iframe for every width: from `lg`
// it is the right-hand pane; below, the same element becomes a full-screen
// sheet behind the header's eye button (focus trapped, Escape closes, focus
// returns) and is `inert` + hidden while closed, so the frame keeps its state.
// The page sits in a phone (390 × 844) or a laptop (1280 × 800) frame on a
// dotted stage, scaled as one to fit (PreviewDevice, spec 051).

import { useLayoutEffect, useRef, useState } from 'react';
import { Monitor, Smartphone, X } from 'lucide-react';
import { useDialog } from '@/lib/useDialog';
import { usePreviewChannel } from './usePreviewChannel';
import type { PreviewMessage } from './previewMessages';
import PreviewDevice, { deviceSize, type Device } from './PreviewDevice';

const STAGE_PADDING = 48;

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
  subject = 'event',
}: {
  message: PreviewMessage;
  /** What the frame shows: the event page, or an application form (spec 051). */
  subject?: 'event' | 'form';
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

  const outer = deviceSize(device);
  const scale = stage.width ? Math.max(0.1, Math.min(1, (stage.width - STAGE_PADDING) / outer.width, (stage.height - STAGE_PADDING) / outer.height)) : 0.5;

  return (
    <section
      ref={panelRef}
      aria-label={subject === 'form' ? 'Live preview of the application form' : 'Live preview of the event page'}
      {...(sheet ? { role: 'dialog', 'aria-modal': true, 'aria-hidden': !open || undefined } : {})}
      className={
        sheet
          ? `${open ? 'fixed' : 'hidden'} inset-0 z-50 flex flex-col bg-gray-50 dark:bg-slate-900 motion-safe:animate-fade-in`
          : 'relative flex min-h-0 flex-1 flex-col border-l border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900'
      }
    >
      {/* Dotted stage under everything, a layer of its own so nothing inherits its colour. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 text-gray-300 dark:text-slate-700"
        style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1.5px)', backgroundSize: '20px 20px' }}
      />
      <div className="relative flex shrink-0 items-center justify-center px-4 pt-4">
        {/* Native radios: arrow keys move the choice, one Tab stop (§8.3: a radio group, not a switch). Icons, named by sr-only text. */}
        <fieldset className="inline-flex rounded-full border border-gray-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <legend className="sr-only">Preview size</legend>
          {(['phone', 'desktop'] as Device[]).map((value) => (
            <label key={value} className="relative" title={value === 'phone' ? 'Phone' : 'Desktop'}>
              <input
                type="radio"
                name="setup-preview-size"
                value={value}
                checked={device === value}
                onChange={() => setDevice(value)}
                className="peer sr-only"
              />
              <span className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900 peer-checked:bg-gray-900 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white dark:peer-checked:bg-slate-100 dark:peer-checked:text-slate-900 dark:peer-focus-visible:ring-offset-slate-900">
                {value === 'phone' ? <Smartphone className="h-5 w-5" aria-hidden /> : <Monitor className="h-5 w-5" aria-hidden />}
                <span className="sr-only">{value === 'phone' ? 'Phone' : 'Desktop'}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {sheet && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <PreviewDevice
          ref={frameRef}
          device={device}
          scale={scale}
          ready={ready}
          title={subject === 'form' ? 'Application form preview' : 'Event page preview'}
        />
      </div>
    </section>
  );
}
