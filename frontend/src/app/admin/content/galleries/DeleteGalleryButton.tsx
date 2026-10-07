'use client';

// Delete gallery: confirm (naming where it is placed), delete, back to the list.

import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import { showToast } from '@/components/content/Toast';
import type { Gallery } from '@/lib/galleries';
import { useGalleriesApi } from './useGalleriesApi';

export default function DeleteGalleryButton({ gallery }: { gallery: Gallery }) {
  const router = useRouter();
  const galleriesApi = useGalleriesApi();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const remove = async () => {
    setDeleting(true);
    try {
      await galleriesApi.remove(gallery.id);
      router.push('/admin/content/galleries');
    } catch (err: any) {
      setDeleting(false);
      setOpen(false);
      showToast(err?.message || 'Delete failed');
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        Delete
      </button>
      {open && (
        <ConfirmDialog
          titleId="delete-gallery-title"
          title={`Delete ${gallery.title}?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          returnFocusRef={buttonRef}
          onClose={() => setOpen(false)}
          onConfirm={() => void remove()}
        >
          <p>The gallery is removed. Its photos stay in Files.</p>
          {gallery.placements.length > 0 && (
            <p>It disappears from {gallery.placements.map((placement) => placement.title).join(', ')}.</p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
