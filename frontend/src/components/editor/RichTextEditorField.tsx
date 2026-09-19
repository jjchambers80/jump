'use client';

// Client-only wrapper: Tiptap must not render on the server (Next 14 SSR).
import dynamic from 'next/dynamic';
import type { RichTextEditorProps } from './RichTextEditor';

const RichTextEditor = dynamic(() => import('./RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div className="min-h-40 animate-pulse rounded-md border border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-900" />
  ),
});

export default function RichTextEditorField(props: RichTextEditorProps) {
  return <RichTextEditor {...props} />;
}
