// Themed Content › Pages / blog routes (spec 038B): the theme's header and
// footer around today's fixed bodies (038G turns them into templates). The
// body comes from the same gated public route the client view uses, fetched
// on the server with the visitor's store access.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { lockFrom, storefrontGet, type StorefrontFrame } from './server/storefront';
import ThemedStorefront from './ThemedStorefront';

type ThemedFrame = Exclude<StorefrontFrame, { kind: 'legacy' }>;


export default async function ThemedContentPage<T>({
  frame,
  path,
  notFoundTitle,
  children,
}: {
  frame: ThemedFrame;
  path: string;
  notFoundTitle: string;
  children: (data: T) => ReactNode;
}) {
  if (frame.kind === 'locked') return <ThemedStorefront frame={frame}>{null}</ThemedStorefront>;
  const response = await storefrontGet<T>(path);
  // The frame answered, so a lock here means access changed between the two calls.
  const lock = lockFrom(response);
  if (lock) return <ThemedStorefront frame={{ kind: 'locked', lock, hadAccessCookie: false }}>{null}</ThemedStorefront>;
  const slug = frame.data.organization.slug;
  return (
    <ThemedStorefront frame={frame}>
      {response.status === 200 && response.body ? (
        children(response.body)
      ) : (
        <main className="flex min-h-[50vh] items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {response.status === 404 ? notFoundTitle : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
              {response.status === 404 ? 'It may have been moved or is not published yet.' : 'Try again in a moment.'}
            </p>
            <Link href={`/organizations/${slug}`} className="mt-4 inline-block text-sm font-medium text-brand-link hover:underline">
              Back to the organization page
            </Link>
          </div>
        </main>
      )}
    </ThemedStorefront>
  );
}
