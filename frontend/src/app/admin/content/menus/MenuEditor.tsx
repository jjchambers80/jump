'use client';

// Menu editor: name + a three-level drag-and-drop tree of items. Nothing
// persists until Save (whole-tree PUT). Every drag action also has a keyboard
// / button path (Move up / down, Indent / Outdent) with live announcements.

import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Plus, Trash2 } from 'lucide-react';
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import { SortableTree, type TreeItemComponentProps, type TreeItems } from 'dnd-kit-sortable-tree';
import ConfirmDialog from '@/components/content/ConfirmDialog';
import SaveBar from '@/components/content/SaveBar';
import ToastHost, { showToast } from '@/components/content/Toast';
import {
  MENU_MAX_DEPTH,
  type Menu,
  type MenuItemInput,
  type MenuItemNode,
  type MenuLinkType,
} from '@/lib/menus';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import MenuItemRow, { type MenuDraftItem, type RowActions } from './MenuItemRow';
import { useMenusApi } from './useMenusApi';

type Node = TreeItems<MenuDraftItem>[number];

let draftCounter = 0;
const draftId = () => `draft-${(draftCounter += 1)}`;

function fromServer(items: MenuItemNode[]): TreeItems<MenuDraftItem> {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    linkType: item.linkType,
    targetId: item.targetId,
    url: item.url,
    newTab: item.newTab,
    targetTitle: item.target.title,
    status: item.target.status,
    editing: false,
    children: fromServer(item.children),
  }));
}

function toInput(items: TreeItems<MenuDraftItem>): MenuItemInput[] {
  return items.map((item) => ({
    label: item.label.trim(),
    linkType: item.linkType,
    targetId: item.targetId,
    url: item.url,
    newTab: item.newTab,
    children: toInput(item.children ?? []),
  }));
}

function subtreeDepth(node: Node): number {
  const children = node.children ?? [];
  return children.length
    ? 1 + Math.max(...children.map((child) => subtreeDepth(child as Node)))
    : 1;
}

/** Attach depth-aware canHaveChildren so drops never exceed MENU_MAX_DEPTH. */
function withDepthRules(items: TreeItems<MenuDraftItem>, depth = 1): TreeItems<MenuDraftItem> {
  return items.map((item) => ({
    ...item,
    canHaveChildren: (drag: Node) => depth + subtreeDepth(drag) <= MENU_MAX_DEPTH,
    children: withDepthRules(item.children ?? [], depth + 1),
  }));
}

function stripRules(items: TreeItems<MenuDraftItem>): TreeItems<MenuDraftItem> {
  return items.map(({ canHaveChildren, ...item }) => ({
    ...item,
    children: stripRules(item.children ?? []),
  }));
}

/** Locate a node: returns its siblings array, index, and parent (null at root). */
function locate(
  items: TreeItems<MenuDraftItem>,
  id: string,
  parent: Node | null = null
): { siblings: TreeItems<MenuDraftItem>; index: number; parent: Node | null } | null {
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) return { siblings: items, index, parent };
  for (const item of items) {
    const found = locate(item.children ?? [], id, item);
    if (found) return found;
  }
  return null;
}

function depthOf(items: TreeItems<MenuDraftItem>, id: string, depth = 1): number {
  for (const item of items) {
    if (item.id === id) return depth;
    const found = depthOf(item.children ?? [], id, depth + 1);
    if (found) return found;
  }
  return 0;
}

function clone(items: TreeItems<MenuDraftItem>): TreeItems<MenuDraftItem> {
  return items.map((item) => ({ ...item, children: clone(item.children ?? []) }));
}

function mapNode(
  items: TreeItems<MenuDraftItem>,
  id: string,
  fn: (node: Node) => Node
): TreeItems<MenuDraftItem> {
  return items.map((item) =>
    item.id === id ? fn(item) : { ...item, children: mapNode(item.children ?? [], id, fn) }
  );
}

function isValid(items: TreeItems<MenuDraftItem>): boolean {
  return items.every((item) => {
    if (!item.label.trim()) return false;
    if (['EVENT', 'VENUE', 'PAGE', 'BLOG', 'BLOG_POST'].includes(item.linkType) && !item.targetId)
      return false;
    if (item.linkType === 'EXTERNAL' && !item.url) return false;
    return isValid(item.children ?? []);
  });
}

interface MenuEditorProps {
  menu: Menu;
  onSaved: (menu: Menu) => void;
}

export default function MenuEditor({ menu, onSaved }: MenuEditorProps) {
  const router = useRouter();
  const menusApi = useMenusApi();
  const [title, setTitle] = useState(menu.title);
  const [items, setItems] = useState<TreeItems<MenuDraftItem>>(() => fromServer(menu.items));
  const [saved, setSaved] = useState(() => ({
    title: menu.title,
    items: JSON.stringify(toInput(fromServer(menu.items))),
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);

  const dirty = title.trim() !== saved.title || JSON.stringify(toInput(items)) !== saved.items;
  const valid = title.trim().length > 0 && isValid(items);
  const confirmLeave = useUnsavedChanges(dirty);

  const announce = useCallback((message: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(message));
  }, []);

  const newItem = (): Node => ({
    id: draftId(),
    label: '',
    linkType: 'HOME' as MenuLinkType,
    targetId: null,
    url: null,
    newTab: false,
    targetTitle: null,
    status: 'new',
    editing: true,
    children: [],
  });

  const actions: RowActions = {
    update: (id, patch) =>
      setItems((current) => mapNode(current, id, (node) => ({ ...node, ...patch }))),
    remove: (id) =>
      setItems((current) => {
        const next = clone(current);
        const found = locate(next, id);
        if (found) {
          const [removed] = found.siblings.splice(found.index, 1);
          announce(`Removed ${removed.label || 'item'}`);
        }
        return next;
      }),
    addChild: (id) =>
      setItems((current) => {
        const next = clone(current);
        const found = locate(next, id);
        if (found) {
          const parent = found.siblings[found.index];
          parent.children = [...(parent.children ?? []), newItem()];
          parent.collapsed = false;
        }
        return next;
      }),
    move: (id, direction) =>
      setItems((current) => {
        const next = clone(current);
        const found = locate(next, id);
        if (!found) return current;
        const { siblings, index, parent } = found;
        const node = siblings[index];
        if (direction === 'up' && index > 0) {
          siblings.splice(index, 1);
          siblings.splice(index - 1, 0, node);
          announce(`Moved ${node.label} up to position ${index}`);
        } else if (direction === 'down' && index < siblings.length - 1) {
          siblings.splice(index, 1);
          siblings.splice(index + 1, 0, node);
          announce(`Moved ${node.label} down to position ${index + 2}`);
        } else if (direction === 'indent' && index > 0) {
          const depth = depthOf(next, id);
          if (depth + subtreeDepth(node) - 1 >= MENU_MAX_DEPTH) {
            announce(`Menus can be ${MENU_MAX_DEPTH} levels deep`);
            return current;
          }
          const newParent = siblings[index - 1];
          siblings.splice(index, 1);
          newParent.children = [...(newParent.children ?? []), node];
          newParent.collapsed = false;
          announce(`Moved ${node.label} under ${newParent.label}`);
        } else if (direction === 'outdent' && parent) {
          const grand = locate(next, parent.id as string);
          if (!grand) return current;
          siblings.splice(index, 1);
          grand.siblings.splice(grand.index + 1, 0, node);
          announce(`Moved ${node.label} out to the level of ${parent.label}`);
        } else {
          return current;
        }
        return next;
      }),
  };

  const treeItems = useMemo(() => withDepthRules(items), [items]);

  const save = async () => {
    if (!dirty || !valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await menusApi.replace(menu.id, {
        title: title.trim(),
        items: toInput(items),
      });
      setItems(fromServer(result.items));
      setTitle(result.title);
      setSaved({ title: result.title, items: JSON.stringify(toInput(fromServer(result.items))) });
      onSaved(result);
      showToast('Menu saved');
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setTitle(menu.title);
    setItems(fromServer(menu.items));
  };

  const duplicate = async () => {
    if (!confirmLeave()) return;
    try {
      const copy = await menusApi.duplicate(menu.id);
      router.push(`/admin/content/menus/${copy.id}`);
    } catch (err: any) {
      showToast(err?.message || 'Could not duplicate the menu');
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await menusApi.remove(menu.id);
      router.push('/admin/content/menus');
    } catch (err: any) {
      setDeleting(false);
      setConfirmDelete(false);
      showToast(err?.message || 'Delete failed');
    }
  };

  const Row = useMemo(
    () =>
      forwardRef<HTMLDivElement, TreeItemComponentProps<MenuDraftItem>>(function Row(props, ref) {
        return <MenuItemRow {...props} ref={ref} actions={actions} maxDepth={MENU_MAX_DEPTH} />;
      }),
    // actions is stable per render of the editor; the row reads the latest via closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-28">
      <ToastHost />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4"
        data-testid="menu-header"
      >
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => {
              if (confirmLeave()) router.push('/admin/content/menus');
            }}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Menus
          </button>
          <h1 className="mt-1 truncate text-2xl font-bold text-gray-900 dark:text-white">
            {menu.title}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void duplicate()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Copy className="h-4 w-4" aria-hidden />
            Duplicate
          </button>
          {!menu.isDefault && (
            <button
              ref={deleteRef}
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 dark:border-slate-600 dark:bg-slate-800 dark:text-red-300"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete
            </button>
          )}
        </div>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <label
          htmlFor="menu-name"
          className="block text-sm font-medium text-gray-700 dark:text-slate-300"
        >
          Name
        </label>
        <input
          id="menu-name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={100}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
        />
        <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Handle: {menu.handle}</p>
      </section>

      <section
        className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        data-testid="menu-items"
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Menu items</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Drag items to reorder or nest them (up to {MENU_MAX_DEPTH} levels). Each row also has Move
          and Indent buttons.
        </p>
        <div className="mt-4">
          {items.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-slate-600 dark:text-slate-400">
              No items yet.
            </p>
          ) : (
            <SortableTree
              items={treeItems}
              onItemsChanged={(next, reason) => {
                setItems(stripRules(next));
                if (reason.type === 'dropped') {
                  announce(
                    reason.droppedToParent
                      ? `Moved ${reason.draggedItem.label} under ${reason.droppedToParent.label}`
                      : `Moved ${reason.draggedItem.label} to the top level`
                  );
                }
              }}
              TreeItemComponent={Row}
              indentationWidth={32}
              pointerSensorOptions={{ activationConstraint: { distance: 6 } }}
              dropAnimation={null}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => setItems((current) => [...current, newItem()])}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add menu item
        </button>
      </section>

      <SaveBar
        visible={dirty}
        saving={saving}
        disabled={!valid}
        error={saveError}
        onDiscard={discard}
        onSave={() => void save()}
      />

      {confirmDelete && (
        <ConfirmDialog
          titleId="delete-menu-title"
          title={`Delete ${menu.title}?`}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          returnFocusRef={deleteRef}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        >
          <p>The menu and its items are removed. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
