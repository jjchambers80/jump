'use client';

// Parent side of the preview channel (spec 050 §8.3): waits for the frame's
// ready signal (from our iframe, same origin), then posts the current message
// on every change. targetOrigin is our own origin, never '*'.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { PREVIEW_READY, trustedMessage, type PreviewMessage } from './previewMessages';

export function usePreviewChannel(frameRef: RefObject<HTMLIFrameElement>, message: PreviewMessage) {
  const [ready, setReady] = useState(false);
  const latest = useRef(message);
  latest.current = message;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!trustedMessage(event, frameRef.current?.contentWindow)) return;
      if ((event.data as { type?: string })?.type !== PREVIEW_READY) return;
      // A reloaded frame says ready again: answer it with the current state.
      frameRef.current?.contentWindow?.postMessage(latest.current, window.location.origin);
      setReady(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);

  const key = JSON.stringify(message);
  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(latest.current, window.location.origin);
  }, [ready, key, frameRef]);

  return ready;
}
