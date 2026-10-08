'use client';

// Gallery editor: title, optional description and where the gallery is placed.

import Link from 'next/link';
import type { GalleryPlacement } from '@/lib/galleries';

interface GalleryDetailsCardProps {
  title: string;
  description: string;
  handle: string;
  placements: GalleryPlacement[];
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
}

const field =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white';
const KIND_LABEL = { PAGE: 'Page', BLOG_POST: 'Blog post', THEME: 'Theme' } as const;

export default function GalleryDetailsCard({
  title,
  description,
  handle,
  placements,
  onTitle,
  onDescription,
}: GalleryDetailsCardProps) {
  return (
    <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5 md:grid-cols-[1fr_16rem]">
      <div className="space-y-4">
        <div>
          <label htmlFor="gallery-name" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Title
          </label>
          <input
            id="gallery-name"
            value={title}
            onChange={(event) => onTitle(event.target.value)}
            maxLength={100}
            aria-invalid={!title.trim() || undefined}
            className={field}
          />
          {!title.trim() && (
            <p className="mt-1 text-sm text-red-700 dark:text-red-400">A gallery needs a title.</p>
          )}
        </div>
        <div>
          <label htmlFor="gallery-description" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
            Description <span className="font-normal text-gray-500 dark:text-slate-400">(optional, admin only)</span>
          </label>
          <textarea
            id="gallery-description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(event) => onDescription(event.target.value)}
            className={field}
          />
        </div>
      </div>
      <div className="border-t border-gray-200 pt-4 dark:border-slate-700 md:border-l md:border-t-0 md:pl-4 md:pt-0">
        <h2 className="text-sm font-medium text-gray-700 dark:text-slate-300">Used in</h2>
        {placements.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {placements.map((placement) => (
              <li key={`${placement.kind}:${placement.targetId}`}>
                <Link href={placement.href} className="text-accent-700 hover:underline dark:text-accent-300">
                  {placement.title}
                </Link>
                <span className="text-gray-500 dark:text-slate-400"> · {KIND_LABEL[placement.kind]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
            Not placed yet. Add it to a page from the page or theme editor.
          </p>
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Handle: {handle}</p>
      </div>
    </section>
  );
}
