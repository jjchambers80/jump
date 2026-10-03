'use client';

// Theme code editor: /admin/online-store/themes/[themeId]/code (spec 043).
// Full screen like the visual editor; Monaco loads only on this route.

import dynamic from 'next/dynamic';

const CodeEditor = dynamic(() => import('@/theme/code/CodeEditor'), {
  ssr: false,
  loading: () => <div className="min-h-screen animate-pulse bg-gray-100" aria-busy="true" aria-label="Loading the code editor" />,
});

export default function ThemeCodePage({ params }: { params: { themeId: string } }) {
  return <CodeEditor themeId={params.themeId} />;
}
