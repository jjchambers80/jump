'use client';

// @jump/theme field specs → Puck fields (spec 038 §6.2). One spec drives the
// server validator and these editor fields, so they cannot disagree.

import { useId, useRef, useState } from 'react';
import FilePickerDialog from '@/components/content/FilePickerDialog';
import RichTextEditorField from '@/components/editor/RichTextEditorField';
import LinkPicker, { type LinkChoice } from '@/app/admin/content/menus/LinkPicker';
import { resolveAssetUrl } from '@/lib/assets';
import type { MenuLinkType } from '@/lib/menus';
import type { CustomField, Field } from './puck';
import { useEditorServices } from './EditorServices';

export interface FieldSpec {
  kind: string;
  label: string;
  default?: unknown;
  max?: number;
  min?: number;
  step?: number;
  unit?: string;
  options?: unknown[];
  target?: string;
}

export interface FieldContext {
  schemes: { id: string; name: string }[];
  menus: { id: string; title: string }[];
  galleries?: { id: string; title: string; photoCount: number }[];
}

const OPTION_LABELS: Record<string, string> = {
  'date-asc': 'Soonest first',
  'date-desc': 'Latest first',
  'scroll-up': 'On scroll up',
  'full-bleed': 'Image behind text',
  'split-left': 'Image on the left',
  'split-right': 'Image on the right',
  grouped: 'Grouped by month',
  off: 'Off',
  always: 'Always',
  '5s': 'Every 5 seconds',
  '8s': 'Every 8 seconds',
  none: 'None',
  screen: 'Fill the window',
};

export function optionLabel(value: unknown) {
  const s = String(value);
  return OPTION_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}

export const input =
  'block w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30';
const small = 'mt-1 text-xs text-gray-500';
export const button =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:cursor-not-allowed disabled:opacity-50';

type ImageValue = { fileId: string; alt?: string; decorative?: boolean } | null;

export function ImageFieldControl({ label, value, onChange }: { label: string; value: ImageValue; onChange: (v: ImageValue) => void }) {
  const [open, setOpen] = useState(false);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const services = useEditorServices();
  const altId = useId();
  const url = value?.fileId ? services.fileUrl(value.fileId) : null;
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-gray-700">{label}</span>
      {value?.fileId && (
        <div className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveAssetUrl(url) || undefined} alt="" className="h-28 w-full object-cover" />
          ) : (
            <p className="p-3 text-xs text-gray-500">Image selected</p>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button ref={chooseRef} type="button" className={button} onClick={() => setOpen(true)}>
          {value?.fileId ? 'Replace image' : 'Choose image'}
        </button>
        {value?.fileId && (
          <button type="button" className={button} onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
      {value?.fileId && (
        <>
          <label htmlFor={altId} className="block text-sm font-medium text-gray-700">
            Alt text
          </label>
          <input
            id={altId}
            className={input}
            maxLength={200}
            disabled={value.decorative}
            value={value.alt ?? ''}
            onChange={(e) => onChange({ ...value, alt: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={Boolean(value.decorative)}
              onChange={(e) => onChange({ ...value, decorative: e.target.checked })}
            />
            Decorative (no alt text needed)
          </label>
          {!value.decorative && !value.alt?.trim() && <p className="text-xs text-amber-700">Describe the image, or mark it decorative.</p>}
        </>
      )}
      {open && (
        <FilePickerDialog
          returnFocusRef={chooseRef}
          onClose={() => setOpen(false)}
          onPick={(file) => {
            services.registerFile(file);
            onChange({ fileId: file.id, alt: value?.alt || file.altText || '', ...(value?.decorative ? { decorative: true } : {}) });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

type VideoValue = { fileId: string } | null;

function VideoFieldControl({ label, value, onChange }: { label: string; value: VideoValue; onChange: (v: VideoValue) => void }) {
  const [open, setOpen] = useState(false);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const services = useEditorServices();
  const url = value?.fileId ? services.fileUrl(value.fileId) : null;
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-gray-700">{label}</span>
      {value?.fileId &&
        (url ? (
          <video src={resolveAssetUrl(url) || undefined} muted preload="metadata" aria-hidden className="h-28 w-full rounded-md bg-black object-cover" />
        ) : (
          <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">Video selected</p>
        ))}
      <div className="flex gap-2">
        <button ref={chooseRef} type="button" className={button} onClick={() => setOpen(true)}>
          {value?.fileId ? 'Replace video' : 'Choose video'}
        </button>
        {value?.fileId && (
          <button type="button" className={button} onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
      <p className={small}>Plays muted on a loop with a pause button. The image is shown while it loads and to visitors who prefer reduced motion.</p>
      {open && (
        <FilePickerDialog
          kind="video"
          returnFocusRef={chooseRef}
          onClose={() => setOpen(false)}
          onPick={(file) => {
            services.registerFile(file);
            onChange({ fileId: file.id });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

type LinkValue = { type: string; targetId?: string; url?: string } | null;

export function LinkFieldControl({ id, label, value, onChange }: { id: string; label: string; value: LinkValue; onChange: (v: LinkValue) => void }) {
  const choice: LinkChoice | null = value
    ? { linkType: value.type as MenuLinkType, targetId: value.targetId ?? null, url: value.url ?? null, title: null }
    : null;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <LinkPicker
        inputId={id}
        value={choice}
        onChange={(next) =>
          onChange({
            type: next.linkType,
            ...(next.targetId ? { targetId: next.targetId } : {}),
            ...(next.linkType === 'EXTERNAL' && next.url ? { url: next.url } : {}),
          })
        }
      />
      {value && (
        <button type="button" className="text-xs font-medium text-accent-700 hover:underline" onClick={() => onChange(null)}>
          Remove link
        </button>
      )}
    </div>
  );
}

/** Gallery section picker (spec 046): the store's galleries, a link to manage them, and an empty-gallery hint. */
function GalleryFieldControl({
  id,
  label,
  value,
  galleries,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  galleries: { id: string; title: string; photoCount: number }[];
  onChange: (v: string | null) => void;
}) {
  const picked = galleries.find((gallery) => gallery.id === value);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <select id={id} className={input} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose a gallery</option>
        {value && !picked && <option value={value}>Deleted gallery</option>}
        {galleries.map((gallery) => (
          <option key={gallery.id} value={gallery.id}>
            {gallery.title}
          </option>
        ))}
      </select>
      {value && !picked && <p className="mt-1 text-xs text-red-700">This gallery was deleted. Choose another.</p>}
      {picked && picked.photoCount === 0 && (
        <p className="mt-1 text-xs text-amber-800">This gallery has no photos yet, so the section shows nothing.</p>
      )}
      {!galleries.length && <p className={small}>No galleries yet.</p>}
      <a
        href={picked ? `/admin/content/galleries/${picked.id}` : '/admin/content/galleries'}
        target="_blank"
        rel="noopener"
        className="inline-block text-xs font-medium text-accent-700 underline"
      >
        {picked ? 'Edit this gallery' : 'Manage galleries'} <span aria-hidden>↗</span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

export function DateTimeControl({ id, label, value, onChange }: { id: string; label: string; value: string | null; onChange: (v: string | null) => void }) {
  // Shown in the browser's zone; stored as an instant (ISO).
  const local = value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type="datetime-local"
        className={input}
        value={local}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
      />
    </div>
  );
}

const custom = <V,>(label: string, render: CustomField<V>['render']): CustomField<V> => ({ type: 'custom', label, render });

/** One @jump/theme field spec → one Puck field. */
export function puckField(spec: FieldSpec, ctx: FieldContext): Field {
  switch (spec.kind) {
    // Stored documents only carry what the organizer set; show the default
    // the storefront will use as a placeholder instead of an empty box.
    case 'text':
      return { type: 'text', label: spec.label, placeholder: spec.default ? String(spec.default) : undefined };
    case 'textarea':
      return { type: 'textarea', label: spec.label, placeholder: spec.default ? String(spec.default) : undefined };
    case 'richtext':
      return custom<string>(spec.label, ({ value, onChange, id }) => (
        <div className="space-y-1">
          <span id={`${id}-label`} className="block text-sm font-medium text-gray-700">
            {spec.label}
          </span>
          <RichTextEditorField value={value ?? ''} onChange={onChange} variant="compact" aria-labelledby={`${id}-label`} />
        </div>
      ));
    case 'select':
    case 'radio':
      return {
        type: spec.kind === 'radio' ? 'radio' : 'select',
        label: spec.label,
        options: (spec.options ?? []).map((value) => ({ label: optionLabel(value), value: value as string })),
      };
    case 'range':
      return {
        type: 'number',
        label: spec.unit ? `${spec.label} (${spec.unit})` : spec.label,
        min: spec.min,
        max: spec.max,
        step: spec.step,
        placeholder: spec.default !== undefined && spec.default !== null ? `Default: ${spec.default}` : undefined,
      };
    case 'toggle':
      return { type: 'radio', label: spec.label, options: [{ label: 'On', value: true }, { label: 'Off', value: false }] } as Field;
    case 'colorScheme':
      return { type: 'select', label: spec.label, options: ctx.schemes.map((s) => ({ label: s.name, value: s.id })) };
    case 'image':
      return custom<ImageValue>(spec.label, ({ value, onChange }) => <ImageFieldControl label={spec.label} value={value ?? null} onChange={onChange} />);
    case 'video':
      return custom<VideoValue>(spec.label, ({ value, onChange }) => <VideoFieldControl label={spec.label} value={value ?? null} onChange={onChange} />);
    case 'link':
      return custom<LinkValue>(spec.label, ({ id, value, onChange }) => <LinkFieldControl id={id} label={spec.label} value={value ?? null} onChange={onChange} />);
    case 'reference':
      if (spec.target === 'menu') {
        return {
          type: 'select',
          label: spec.label,
          options: [{ label: 'Default menu', value: null as unknown as string }, ...ctx.menus.map((m) => ({ label: m.title, value: m.id }))],
        };
      }
      if (spec.target === 'gallery') {
        return custom<string | null>(spec.label, ({ id, value, onChange }) => (
          <GalleryFieldControl id={id} label={spec.label} value={value ?? null} galleries={ctx.galleries ?? []} onChange={onChange} />
        ));
      }
      return { type: 'text', label: spec.label };
    case 'datetime':
      return custom<string | null>(spec.label, ({ id, value, onChange }) => <DateTimeControl id={id} label={spec.label} value={value ?? null} onChange={onChange} />);
    default:
      return { type: 'text', label: spec.label };
  }
}

export { small };
