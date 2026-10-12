// Device frames around the wizard's preview iframe (spec 051): a phone with
// a status bar and island, or a laptop with a browser bar and a base. The
// whole device scales as one to fit the stage; the page inside keeps its real
// viewport (390 × 844 or 1280 × 800) and scrolls inside the screen.

import { forwardRef } from 'react';

export type Device = 'phone' | 'desktop';

/** The page's own viewport inside each frame. */
export const SCREEN: Record<Device, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

// Frame parts, in CSS px at scale 1.
const PHONE = { bezel: 12, status: 32 };
const LAPTOP = { bezel: 14, bar: 32, base: 18, lip: 48 };

/** Outer size of a device at scale 1, for fitting it to the stage. */
export function deviceSize(device: Device) {
  const { width, height } = SCREEN[device];
  if (device === 'phone') return { width: width + PHONE.bezel * 2, height: height + PHONE.status + PHONE.bezel * 2 };
  return { width: width + LAPTOP.bezel * 2 + LAPTOP.lip * 2, height: height + LAPTOP.bar + LAPTOP.bezel * 2 + LAPTOP.base };
}

interface Props {
  device: Device;
  scale: number;
  title: string;
  ready: boolean;
}

const PreviewDevice = forwardRef<HTMLIFrameElement, Props>(function PreviewDevice({ device, scale, title, ready }, frameRef) {
  const { width, height } = SCREEN[device];
  const outer = deviceSize(device);
  const phone = device === 'phone';
  // One element tree for both devices (only classes and the chrome inside
  // change), so switching keeps the iframe mounted: no reload, no lost scroll.
  return (
    <div style={{ width: outer.width * scale, height: outer.height * scale }} className="relative shrink-0">
      <div style={{ width: outer.width, transform: `scale(${scale})`, transformOrigin: 'top left' }} className="absolute left-0 top-0">
        <div
          className={`bg-gray-900 shadow-xl shadow-gray-900/20 ring-1 ring-black/10 dark:ring-slate-600 ${phone ? 'rounded-[3.25rem]' : 'rounded-t-2xl'}`}
          style={phone ? { padding: PHONE.bezel } : { padding: LAPTOP.bezel, marginLeft: LAPTOP.lip, marginRight: LAPTOP.lip }}
        >
          <div className={`overflow-hidden ${phone ? 'rounded-[2.5rem] bg-gray-900' : 'rounded-md'}`}>
            {phone ? (
              <div aria-hidden className="flex items-center justify-center" style={{ height: PHONE.status }}>
                <span className="h-6 w-28 rounded-full bg-black" />
              </div>
            ) : (
              <div aria-hidden className="flex items-center gap-2 bg-gray-100 px-3 dark:bg-slate-800" style={{ height: LAPTOP.bar }}>
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                <span className="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-slate-600" />
                <span className="mx-auto h-5 w-1/2 rounded-full bg-white dark:bg-slate-900" />
              </div>
            )}
            <div className="relative bg-white dark:bg-slate-900" style={{ width, height }}>
              {!ready && <div aria-hidden className="absolute inset-3 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-800" />}
              <iframe ref={frameRef} src="/admin/events/preview-frame" title={title} style={{ width, height }} className={`block border-0 ${ready ? '' : 'opacity-0'}`} />
            </div>
          </div>
        </div>
        {!phone && (
          <div aria-hidden className="rounded-b-xl bg-gray-700 dark:bg-slate-600" style={{ height: LAPTOP.base }}>
            <div className="mx-auto h-1.5 w-24 rounded-b-md bg-gray-800 dark:bg-slate-700" />
          </div>
        )}
      </div>
    </div>
  );
});

export default PreviewDevice;
