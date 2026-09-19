// Public legal pages (spec 023 LR-01/LR-03/LR-04): /legal/terms, /legal/privacy, …
// Server-rendered from frontend/content/legal/<slug>.md on every host, Jump's
// own text with a line naming Jump as the platform. 404 until
// NEXT_PUBLIC_LEGAL_PAGES_ENABLED and the file exist — never a placeholder.

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LEGAL_PAGES_ENABLED } from '@/lib/legal';
import { isLegalSlug, LEGAL_SLUGS, loadLegalDocument } from '@/lib/legalContent';

// Prerendered at build; unknown slugs are 404 without touching the filesystem.
export const dynamicParams = false;
export function generateStaticParams() {
  return LEGAL_PAGES_ENABLED ? LEGAL_SLUGS.map((slug) => ({ slug })) : [];
}

async function documentFor(slug: string) {
  if (!LEGAL_PAGES_ENABLED || !isLegalSlug(slug)) return null;
  return loadLegalDocument(slug);
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const doc = await documentFor(params.slug);
  return doc ? { title: `${doc.title} · Jump` } : {};
}

export default async function LegalPage({ params }: { params: { slug: string } }) {
  const doc = await documentFor(params.slug);
  if (!doc) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 print:py-0">
      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
        Jump · platform legal
      </p>
      <h1 className="mt-1 text-3xl font-semibold text-gray-900 dark:text-slate-100">{doc.title}</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">
        Version {doc.version} · effective {doc.effectiveDate}
      </p>
      <article
        className="prose prose-gray mt-8 max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
    </main>
  );
}
