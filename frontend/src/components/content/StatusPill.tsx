'use client';

import { STATUS_CLASSES, STATUS_LABELS, type BlogPostStatus } from '@/lib/blog';

export default function StatusPill({ status }: { status: BlogPostStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}
      data-testid="status-pill"
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
