'use client';

// Faq island (spec 041). The FaqItem blocks are server-rendered slot markup,
// so the section cannot hand them props: this names them as one exclusive
// group (<details name>, one answer open at a time) and opens the first.
// Without JavaScript every question still opens and closes on its own.

import { useEffect, useRef, type ReactNode } from 'react';
import { FAQ_LIST_CLASS } from './islandClasses';

export default function FaqBehavior({ group, singleOpen, openFirst, children }: { group: string; singleOpen: boolean; openFirst: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = ref.current?.querySelector(`.${FAQ_LIST_CLASS}`);
    if (!list) return;
    const apply = () => {
      const items = Array.from(list.querySelectorAll('details'));
      for (const item of items) {
        if (singleOpen) item.setAttribute('name', group);
        else item.removeAttribute('name');
      }
      if (openFirst && items[0] && !items.some((item) => item.open)) items[0].open = true;
    };
    apply();
    // The editor adds and removes questions under us.
    const changes = new MutationObserver(apply);
    changes.observe(list, { childList: true, subtree: true });
    return () => changes.disconnect();
  }, [group, singleOpen, openFirst]);
  return <div ref={ref}>{children}</div>;
}
