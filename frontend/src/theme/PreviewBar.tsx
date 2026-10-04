'use client';

// Draft theme preview bar (spec 038 D11): says which draft this page shows and
// exits through the route handler that expires the cookie. ClearPreviewCookie
// drops a cookie the backend refused (expired, published or deleted theme):
// Server Components cannot delete cookies in Next 14.

import { useEffect } from 'react';

export default function PreviewBar({ name, path }: { name: string; path: string }) {
  return (
    <div
      role="region"
      aria-label="Theme preview"
      className="sticky bottom-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gray-900 px-4 py-2 text-sm text-white"
    >
      <span>
        Previewing <strong className="font-semibold">{name}</strong> · not visible to your visitors
      </span>
      <a
        href={`/api/storefront/preview?to=${encodeURIComponent(path)}`}
        className="font-semibold underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Exit preview
      </a>
    </div>
  );
}

export function ClearPreviewCookie() {
  useEffect(() => {
    void fetch('/api/storefront/preview', { method: 'DELETE' }).catch(() => {});
  }, []);
  return null;
}
