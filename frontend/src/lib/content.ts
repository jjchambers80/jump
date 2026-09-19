// Content › Files (spec 025) — types and helpers shared by the Files pages
// and, later, the blog editor's file picker. Limits mirror
// backend/src/utils/fileLimits.js.

export const MAX_FILE_MB = 20;
export const MAX_FILES_PER_UPLOAD = 10;
export const FILE_NAME_MAX = 200;
export const FILE_ALT_MAX = 500;

export const ACCEPTED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
];
export const ACCEPT_ATTRIBUTE =
  '.jpg,.jpeg,.png,.gif,.webp,.pdf,image/jpeg,image/png,image/gif,image/webp,application/pdf';

export type StoreFileKind = 'image' | 'document';

export interface StoreFileReference {
  kind: 'PAGE' | 'BLOG_POST';
  targetId: string;
  title: string;
  href: string;
}

export interface StoreFile {
  id: string;
  organizationId: string;
  name: string;
  extension: string;
  kind: StoreFileKind;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  url: string;
  downloadUrl: string;
  thumbUrl: string | null;
  previewUrl: string | null;
  focalX: number | null;
  focalY: number | null;
  referenceCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoreFileDetail extends StoreFile {
  references: StoreFileReference[];
}

export interface StoreFileList {
  files: StoreFile[];
  total: number;
  page: number;
  pageSize: number;
}

export type FileTypeFilter = 'all' | 'image' | 'pdf';
export type FileSort = 'created_desc' | 'created_asc' | 'name' | 'size_desc';

export interface StoreFileListQuery {
  q?: string;
  type?: FileTypeFilter;
  sort?: FileSort;
  page?: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 2 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function fileTypeLabel(file: Pick<StoreFile, 'extension'>): string {
  return file.extension.toUpperCase();
}

export function formatDateAdded(value: string): string {
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date
    .toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(',', ' at');
}

/** Client-side pre-check so obviously wrong picks fail before the upload. */
export function validateLocalFile(file: File): string | null {
  const byType = ACCEPTED_FILE_TYPES.includes(file.type);
  const byName = /\.(jpe?g|png|gif|webp|pdf)$/i.test(file.name);
  if (!byType && !byName) return 'Only JPG, PNG, GIF, WebP images and PDF files are supported';
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `Must be ${MAX_FILE_MB} MB or smaller`;
  return null;
}

/** Writes text to the clipboard with a textarea fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
