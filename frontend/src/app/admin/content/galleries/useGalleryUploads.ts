'use client';

// Adding photos to a gallery draft: picked from Files, or dropped on a section
// and uploaded first (in batches of the upload limit). Never past the cap.

import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useFilesApi } from '@/app/admin/content/files/useFilesApi';
import { showToast } from '@/components/content/Toast';
import { MAX_FILES_PER_UPLOAD, type StoreFile } from '@/lib/content';
import { GALLERY_MAX_ITEMS, draftKey, type DraftItem, type DraftSection } from '@/lib/galleries';

const fromFile = (file: StoreFile): DraftItem => ({
  key: draftKey('photo'),
  fileId: file.id,
  altText: null,
  decorative: false,
  caption: null,
  file: {
    name: file.name,
    altText: file.altText,
    width: file.width,
    height: file.height,
    thumbUrl: file.thumbUrl,
    previewUrl: file.previewUrl,
  },
});

export function useGalleryUploads(
  setSections: Dispatch<SetStateAction<DraftSection[]>>,
  room: number,
  announce: (message: string) => void
) {
  const filesApi = useFilesApi();

  const appendPhotos = useCallback(
    (sectionKey: string, files: StoreFile[]) => {
      const images = files.filter((file) => file.kind === 'image').slice(0, Math.max(0, room));
      if (!images.length) return;
      setSections((current) =>
        current.map((section) =>
          section.key === sectionKey ? { ...section, items: [...section.items, ...images.map(fromFile)] } : section
        )
      );
      announce(`Added ${images.length} ${images.length === 1 ? 'photo' : 'photos'}`);
      if (images.length < files.length) showToast(`A gallery holds up to ${GALLERY_MAX_ITEMS} photos`);
    },
    [setSections, room, announce]
  );

  const uploadInto = useCallback(
    async (sectionKey: string, files: File[]) => {
      const uploaded: StoreFile[] = [];
      const failed: string[] = [];
      for (let i = 0; i < files.length; i += MAX_FILES_PER_UPLOAD) {
        try {
          const result = await filesApi.upload(files.slice(i, i + MAX_FILES_PER_UPLOAD));
          uploaded.push(...result.files);
          failed.push(...result.errors.map((error) => `${error.name}: ${error.message}`));
        } catch (err: any) {
          failed.push(err?.message || 'Upload failed');
        }
      }
      appendPhotos(sectionKey, uploaded);
      if (failed.length) showToast(`${failed.length} not uploaded — ${failed[0]}`);
    },
    [filesApi, appendPhotos]
  );

  return { appendPhotos, uploadInto };
}
