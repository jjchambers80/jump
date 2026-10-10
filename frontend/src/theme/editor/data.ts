// Editor data ⇄ theme documents (spec 038 §11). The editor works on ONE Puck
// tree per page: root slots `header`, `template`, `footer`. Save splits it
// back into the header, template and footer documents.
//
// Header and footer blocks (announcements, footer columns) are laid out by
// their section, not by Puck slots, so in the editor they are array fields:
// flattened here on load, rebuilt on save.

import type { ThemeDocumentData } from '@/lib/themes';

/** `home`, `events`, or `page:<pageId>` for a full-width Content page. */
export type TemplateKey = string;
export const TEMPLATE_KEYS: TemplateKey[] = ['home', 'events'];
export const TEMPLATE_LABELS: Record<string, string> = { home: 'Home page', events: 'Events page' };

type Item = { type: string; props: Record<string, any> };

export interface EditorData {
  root: { props: Record<string, any> & { header: Item[]; template: Item[]; footer: Item[] } };
  content: Item[];
  zones?: Record<string, unknown>;
}

const newId = (type: string) =>
  `${type}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;

const pick = (props: Record<string, any>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));

const ANNOUNCEMENT_KEYS = ['text', 'link', 'startsAt', 'endsAt', 'hidden'];
const COLUMN_KEYS: Record<string, string[]> = {
  MenuColumn: ['heading', 'menu', 'hidden'],
  Text: ['heading', 'body', 'hidden'],
  BrandInfo: ['hidden'],
  SocialLinks: ['hidden'],
};

/** Theme item → editor item (array fields for header / footer blocks). */
export function flattenItem(item: Item): Item {
  if (item.type === 'AnnouncementBar') {
    const { blocks = [], ...props } = item.props;
    return {
      type: item.type,
      props: {
        ...props,
        announcements: (blocks as Item[]).map((b) => ({ id: b.props.id, ...pick(b.props, ANNOUNCEMENT_KEYS) })),
      },
    };
  }
  if (item.type === 'Footer') {
    const { blocks = [], ...props } = item.props;
    return {
      type: item.type,
      props: {
        ...props,
        columns: (blocks as Item[]).map((b) => ({ id: b.props.id, kind: b.type, ...pick(b.props, COLUMN_KEYS[b.type] ?? []) })),
      },
    };
  }
  return item;
}

/** Editor item → theme item. Array rows get ids when the editor added them. */
export function unflattenItem(item: Item): Item {
  if (item.type === 'AnnouncementBar') {
    const { announcements = [], ...props } = item.props;
    return {
      type: item.type,
      props: {
        ...props,
        blocks: (announcements as Record<string, any>[]).map((row) => ({
          type: 'Announcement',
          props: { id: row.id || newId('Announcement'), ...clean(pick(row, ANNOUNCEMENT_KEYS)) },
        })),
      },
    };
  }
  if (item.type === 'Footer') {
    const { columns = [], ...props } = item.props;
    return {
      type: item.type,
      props: {
        ...props,
        blocks: (columns as Record<string, any>[]).map((row) => {
          const kind = COLUMN_KEYS[row.kind] ? row.kind : 'Text';
          return { type: kind, props: { id: row.id || newId(kind), ...clean(pick(row, COLUMN_KEYS[kind])) } };
        }),
      },
    };
  }
  return item;
}

/** Drop empty optional values the editor leaves behind (null dates, blank links). */
function clean(props: Record<string, any>) {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== null && v !== undefined));
}

/** `themeSettings`: the stored theme settings, carried in root props so Puck's undo covers them (spike item 6). */
export function toEditorData(
  docs: { header: ThemeDocumentData; footer: ThemeDocumentData; template: ThemeDocumentData },
  themeSettings?: Record<string, any>,
): EditorData {
  return {
    root: {
      props: {
        ...(docs.template.root?.props ?? {}),
        ...(themeSettings ? { themeSettings } : {}),
        header: docs.header.content.map(flattenItem),
        template: docs.template.content.map(flattenItem),
        footer: docs.footer.content.map(flattenItem),
      },
    },
    content: [],
    zones: {},
  };
}

export function fromEditorData(data: EditorData): { header: ThemeDocumentData; template: ThemeDocumentData; footer: ThemeDocumentData } {
  const { header = [], template = [], footer = [], ...rootProps } = data.root.props ?? ({} as EditorData['root']['props']);
  // A cleared number field leaves '' or NaN behind: unset = the theme's page width.
  if (typeof rootProps.pageWidth !== 'number' || !Number.isFinite(rootProps.pageWidth)) delete (rootProps as Record<string, unknown>).pageWidth;
  const doc = (items: Item[], props: Record<string, any> = {}): ThemeDocumentData => ({
    root: { props },
    content: items.map(unflattenItem),
  });
  return {
    header: doc(header),
    template: doc(template, clean(pick(rootProps, ['title', 'seoTitle', 'seoDescription', 'pageWidth']))),
    footer: doc(footer),
  };
}

/** JSON with object keys sorted: Puck reorders props (slot fields first), which is not a change. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/** Stable comparison for dirty tracking. */
export function sameDocument(a: ThemeDocumentData | null | undefined, b: ThemeDocumentData | null | undefined) {
  return stableJson(a) === stableJson(b);
}
