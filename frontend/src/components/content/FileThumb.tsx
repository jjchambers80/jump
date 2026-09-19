'use client';

import { FileText } from 'lucide-react';
import { resolveAssetUrl } from '@/lib/assets';
import type { StoreFile } from '@/lib/content';

export default function FileThumb({
  file,
  size = 'h-10 w-10',
}: {
  file: StoreFile;
  size?: string;
}) {
  if (file.thumbUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolveAssetUrl(file.thumbUrl) || undefined}
        alt=""
        className={`${size} flex-shrink-0 rounded border border-gray-200 object-cover dark:border-slate-600`}
      />
    );
  }
  return (
    <span
      className={`${size} flex flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400 dark:border-slate-600 dark:bg-slate-900`}
      aria-hidden
    >
      <FileText className="h-5 w-5" />
    </span>
  );
}
