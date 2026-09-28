'use client';

import dynamic from 'next/dynamic';
import { spikeDocument, spikeResolved } from '@/theme/spike/fixtures';

const SpikeEditor = dynamic(() => import('@/theme/spike/SpikeEditor'), { ssr: false });

export default function SpikeEditorPage() {
  return (
    <div style={{ height: '100vh' }}>
      <SpikeEditor initialData={spikeDocument(4)} resolved={spikeResolved()} brandColor="#0f766e" />
    </div>
  );
}
