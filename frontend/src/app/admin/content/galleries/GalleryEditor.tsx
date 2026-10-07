'use client';

// Gallery editor (spec 046): title, sections of photos, per-photo alt text
// and captions. Nothing persists until Save (whole-tree PUT). Every drag has
// a button path (section arrows, the photo panel's Move buttons) announced
// in a live region. Save refuses photos without alt text and lists them.

import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Plus } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import FilePickerDialog from '@/components/content/FilePickerDialog';
import SaveBar from '@/components/content/SaveBar';
import ToastHost, { showToast } from '@/components/content/Toast';
import {
  GALLERY_MAX_ITEMS,
  GALLERY_MAX_SECTIONS,
  draftKey,
  fromServer,
  missingAlt,
  moveBy,
  moveToSection,
  needsAlt,
  photoCount,
  toInput,
  type DraftItem,
  type DraftSection,
  type Gallery,
  type MissingAlt,
} from '@/lib/galleries';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { copyText } from '@/lib/content';
import AltTextSummary from './AltTextSummary';
import DeleteGalleryButton from './DeleteGalleryButton';
import GalleryDetailsCard from './GalleryDetailsCard';
import GallerySectionCard from './GallerySectionCard';
import PhotoPanel from './PhotoPanel';
import SectionDeleteDialog from './SectionDeleteDialog';
import { useGalleriesApi } from './useGalleriesApi';
import { useGalleryUploads } from './useGalleryUploads';

export default function GalleryEditor({ gallery, onSaved }: { gallery: Gallery; onSaved: (g: Gallery) => void }) {
  const router = useRouter();
  const galleriesApi = useGalleriesApi();
  const [title, setTitle] = useState(gallery.title);
  const [description, setDescription] = useState(gallery.description ?? '');
  const [sections, setSections] = useState<DraftSection[]>(() => fromServer(gallery));
  const [saved, setSaved] = useState(() =>
    JSON.stringify(toInput(gallery.title, gallery.description ?? '', fromServer(gallery)))
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [problems, setProblems] = useState<MissingAlt[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [openPhoto, setOpenPhoto] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [deleteSection, setDeleteSection] = useState<string | null>(null);
  const pickerReturnRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const input = toInput(title, description, sections);
  const dirty = JSON.stringify(input) !== saved;
  const confirmLeave = useUnsavedChanges(dirty);
  const total = photoCount(sections);
  const room = GALLERY_MAX_ITEMS - total;

  const announce = useCallback((message: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const updateSection = (next: DraftSection) =>
    setSections((current) => current.map((section) => (section.key === next.key ? next : section)));

  const { appendPhotos, uploadInto } = useGalleryUploads(setSections, room, announce);

  const located = openPhoto
    ? sections
        .map((section) => ({ section, index: section.items.findIndex((item) => item.key === openPhoto) }))
        .find((entry) => entry.index >= 0)
    : undefined;

  const closePanel = () => {
    const key = openPhoto;
    setOpenPhoto(null);
    requestAnimationFrame(() => {
      const tile = key && document.querySelector<HTMLElement>(`[data-tile-key="${key}"]`);
      (tile || document.querySelector<HTMLElement>('[data-add-photos]'))?.focus();
    });
  };

  const save = async () => {
    if (saving) return;
    const missing = missingAlt(sections);
    setProblems(missing);
    if (missing.length) {
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const result = await galleriesApi.replace(gallery.id, input);
      const next = fromServer(result);
      setSections(next);
      setTitle(result.title);
      setDescription(result.description ?? '');
      setSaved(JSON.stringify(toInput(result.title, result.description ?? '', next)));
      onSaved(result);
      showToast('Gallery saved');
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setTitle(gallery.title);
    setDescription(gallery.description ?? '');
    setSections(fromServer(gallery));
    setProblems([]);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 pb-28">
      <ToastHost />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => confirmLeave() && router.push('/admin/content/galleries')}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Galleries
          </button>
          <h1 className="mt-1 truncate text-2xl font-bold text-gray-900 dark:text-white">{gallery.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => showToast((await copyText(gallery.id)) ? 'Gallery id copied' : 'Could not copy the id')}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Copy className="h-4 w-4" aria-hidden />
            Copy id
          </button>
          <DeleteGalleryButton gallery={gallery} />
        </div>
      </div>

      <AltTextSummary ref={summaryRef} problems={problems} onOpen={setOpenPhoto} />

      <GalleryDetailsCard
        title={title}
        description={description}
        handle={gallery.handle}
        placements={gallery.placements}
        onTitle={setTitle}
        onDescription={setDescription}
      />

      <div className="mt-6 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Photos</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {total} of {GALLERY_MAX_ITEMS}
        </p>
      </div>
      <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
        On the page, masonry fills each column from top to bottom. Drag photos to reorder, or open one to move it.
      </p>

      <div className="mt-4 space-y-4">
        {sections.map((section, index) => (
          <GallerySectionCard
            key={section.key}
            section={section}
            index={index}
            count={sections.length}
            canAddPhotos={room > 0}
            onChange={updateSection}
            onMove={(offset) => {
              setSections((current) => moveBy(current, index, offset));
              announce(`Moved section to position ${index + offset + 1}`);
            }}
            onDelete={() => (section.items.length ? setDeleteSection(section.key) : setSections((c) => c.filter((s) => s.key !== section.key)))}
            onAddPhotos={() => {
              pickerReturnRef.current = document.querySelector(`[data-add-photos="${section.key}"]`);
              setPickerFor(section.key);
            }}
            onDropFiles={(files) => void uploadInto(section.key, files)}
            onOpenPhoto={setOpenPhoto}
            onReordered={announce}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={sections.length >= GALLERY_MAX_SECTIONS}
        onClick={() => {
          setSections((current) => [...current, { key: draftKey('section'), title: '', items: [] }]);
          announce('Section added');
        }}
        className="mt-4 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-300"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add section
      </button>

      <SaveBar
        visible={dirty}
        saving={saving}
        disabled={!title.trim()}
        error={saveError}
        onDiscard={discard}
        onSave={() => void save()}
      />

      {located && (
        <PhotoPanel
          item={located.section.items[located.index]}
          position={located.index}
          section={located.section}
          sections={sections}
          onChange={(item) => {
            updateSection({
              ...located.section,
              items: located.section.items.map((entry) => (entry.key === item.key ? item : entry)),
            });
            setProblems((current) => current.filter((problem) => problem.itemKey !== item.key || needsAlt(item)));
          }}
          onMove={(offset) => {
            updateSection({ ...located.section, items: moveBy(located.section.items, located.index, offset) });
            announce(`Moved photo to position ${located.index + offset + 1}`);
          }}
          onMoveToSection={(sectionKey) => {
            setSections((current) => moveToSection(current, located.section.items[located.index].key, sectionKey));
            announce('Moved photo to another section');
          }}
          onRemove={() => {
            updateSection({ ...located.section, items: located.section.items.filter((_, i) => i !== located.index) });
            announce('Photo removed from the gallery');
            closePanel();
          }}
          onClose={closePanel}
        />
      )}

      {pickerFor && (
        <FilePickerDialog
          multiple
          title="Add photos"
          returnFocusRef={pickerReturnRef}
          onClose={() => setPickerFor(null)}
          onPickMany={(files) => {
            appendPhotos(pickerFor, files);
            setPickerFor(null);
          }}
        />
      )}

      {deleteSection && (
        <SectionDeleteDialog
          sections={sections}
          sectionKey={deleteSection}
          onClose={() => setDeleteSection(null)}
          onConfirm={(next) => {
            setSections(next);
            setDeleteSection(null);
            announce('Section deleted');
          }}
        />
      )}

    </div>
  );
}
