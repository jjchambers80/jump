'use client';

// Theme editor — /admin/online-store/themes/[themeId]/editor (spec 038 §11).
// Full screen: AdminLayoutClient leaves out the sidebar and header here.
// Puck loads only on this route (dynamic, no SSR), so it never reaches the
// storefront bundle.

import dynamic from 'next/dynamic';

const ThemeEditor = dynamic(() => import('@/theme/editor/ThemeEditor'), {
  ssr: false,
  loading: () => <div className="min-h-screen animate-pulse bg-gray-100" aria-busy="true" aria-label="Loading the theme editor" />,
});

export default function ThemeEditorPage({ params }: { params: { themeId: string } }) {
  return <ThemeEditor themeId={params.themeId} />;
}
