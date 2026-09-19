'use client';

// One row of the menu tree. Collapsed: grip, chevron, label, link summary,
// status badge and the button path for every drag action. Editing: Label +
// Link picker (+ "Open in new tab" for external links) with ✓ / delete.

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  CornerLeftUp,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import type { TreeItemComponentProps } from 'dnd-kit-sortable-tree';
import { LINK_TYPE_LABELS, TARGET_LINK_TYPES, type MenuLinkType } from '@/lib/menus';
import LinkPicker, { type LinkChoice } from './LinkPicker';

export interface MenuDraftItem {
  label: string;
  linkType: MenuLinkType;
  targetId: string | null;
  url: string | null;
  newTab: boolean;
  targetTitle: string | null;
  status: 'ok' | 'missing' | 'hidden' | 'new';
  editing?: boolean;
}

export interface RowActions {
  update: (id: string, patch: Partial<MenuDraftItem>) => void;
  remove: (id: string) => void;
  addChild: (id: string) => void;
  move: (id: string, direction: 'up' | 'down' | 'indent' | 'outdent') => void;
}

type Props = TreeItemComponentProps<MenuDraftItem> & { actions: RowActions; maxDepth: number };

const iconButton =
  'inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white';

function summary(item: MenuDraftItem) {
  if (item.linkType === 'EXTERNAL') return item.url ?? 'Link';
  if (TARGET_LINK_TYPES.includes(item.linkType))
    return `${LINK_TYPE_LABELS[item.linkType]} › ${item.targetTitle ?? '…'}`;
  return LINK_TYPE_LABELS[item.linkType];
}

const MenuItemRow = forwardRef<HTMLDivElement, Props>(function MenuItemRow(props, ref) {
  const {
    item,
    depth,
    childCount,
    collapsed,
    onCollapse,
    handleProps,
    ghost,
    clone,
    wrapperRef,
    style,
    indentationWidth,
    actions,
    maxDepth,
    isLast,
    parent,
  } = props;
  const id = String(item.id);
  const [draftLabel, setDraftLabel] = useState(item.label);
  const [draftLink, setDraftLink] = useState<LinkChoice | null>(
    item.status === 'new' && !item.targetId && !item.url && item.linkType === 'HOME'
      ? null
      : { linkType: item.linkType, targetId: item.targetId, url: item.url, title: item.targetTitle }
  );
  const [error, setError] = useState<string | null>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (item.editing) {
      setDraftLabel(item.label);
      labelRef.current?.focus();
    }
  }, [item.editing, item.label]);

  const needsTarget = draftLink ? TARGET_LINK_TYPES.includes(draftLink.linkType) : true;
  const commit = () => {
    if (!draftLabel.trim()) {
      setError('Add a label');
      labelRef.current?.focus();
      return;
    }
    if (
      !draftLink ||
      (needsTarget && !draftLink.targetId) ||
      (draftLink.linkType === 'EXTERNAL' && !draftLink.url)
    ) {
      setError('Choose where this item links to');
      return;
    }
    actions.update(id, {
      label: draftLabel.trim(),
      linkType: draftLink.linkType,
      targetId: draftLink.targetId,
      url: draftLink.url,
      targetTitle: draftLink.title,
      status:
        draftLink.linkType === item.linkType &&
        draftLink.targetId === item.targetId &&
        item.status !== 'new'
          ? item.status
          : 'ok',
      editing: false,
    });
    setError(null);
  };

  const cancel = () => {
    if (item.status === 'new' && !item.label) actions.remove(id);
    else actions.update(id, { editing: false });
  };

  const badge =
    item.status === 'missing' ? (
      <span
        className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300"
        data-testid="broken-link"
      >
        Broken link
      </span>
    ) : item.status === 'hidden' ? (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        Hidden target
      </span>
    ) : null;

  return (
    <li
      ref={wrapperRef}
      style={{ ...style, paddingLeft: clone ? 0 : indentationWidth * (depth ?? 0) }}
      className={`list-none ${ghost ? 'opacity-40' : ''} ${clone ? 'w-[28rem]' : ''}`}
      data-testid="menu-item-row"
      data-depth={depth}
    >
      <div
        ref={ref}
        className={`mb-2 rounded-md border bg-white dark:bg-slate-900 ${
          item.editing
            ? 'border-indigo-400 p-3 dark:border-indigo-500'
            : 'border-gray-200 px-2 py-1.5 dark:border-slate-600'
        } ${clone ? 'shadow-lg' : ''}`}
      >
        {item.editing ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={`label-${id}`}
                  className="block text-xs font-medium text-gray-700 dark:text-slate-300"
                >
                  Label
                </label>
                <input
                  ref={labelRef}
                  id={`label-${id}`}
                  value={draftLabel}
                  maxLength={60}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commit();
                    }
                    if (event.key === 'Escape') cancel();
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label
                  htmlFor={`link-${id}`}
                  className="block text-xs font-medium text-gray-700 dark:text-slate-300"
                >
                  Link
                </label>
                <div className="mt-1">
                  <LinkPicker inputId={`link-${id}`} value={draftLink} onChange={setDraftLink} />
                </div>
              </div>
            </div>
            {draftLink?.linkType === 'EXTERNAL' && (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={item.newTab}
                  onChange={(event) => actions.update(id, { newTab: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300"
                />
                Open in new tab
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commit}
                aria-label="Confirm item"
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                <Check className="h-4 w-4" aria-hidden />
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="group flex items-center gap-1">
            <button
              type="button"
              {...handleProps}
              aria-label={`Drag ${item.label}`}
              className="inline-flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 active:cursor-grabbing dark:hover:bg-slate-700"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
            {childCount ? (
              <button
                type="button"
                onClick={onCollapse}
                aria-label={collapsed ? `Expand ${item.label}` : `Collapse ${item.label}`}
                aria-expanded={!collapsed}
                className={iconButton}
              >
                {collapsed ? (
                  <ChevronRight className="h-4 w-4" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden />
                )}
              </button>
            ) : (
              <span className="inline-block h-7 w-7" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                {item.label}
              </p>
              <p className="flex items-center gap-1 truncate text-xs text-gray-500 dark:text-slate-400">
                {item.linkType === 'EXTERNAL' && <ExternalLink className="h-3 w-3" aria-hidden />}
                <span className="truncate">{summary(item)}</span>
                {item.newTab && <span>· new tab</span>}
              </p>
            </div>
            {badge}
            <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
              <button
                type="button"
                onClick={() => actions.update(id, { editing: true })}
                aria-label={`Edit ${item.label}`}
                className={iconButton}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </button>
              {(depth ?? 0) + 1 < maxDepth && (
                <button
                  type="button"
                  onClick={() => actions.addChild(id)}
                  aria-label={`Add menu item to ${item.label}`}
                  className={iconButton}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              )}
              <button
                type="button"
                onClick={() => actions.move(id, 'up')}
                aria-label={`Move ${item.label} up`}
                className={iconButton}
              >
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => actions.move(id, 'down')}
                disabled={isLast}
                aria-label={`Move ${item.label} down`}
                className={iconButton}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => actions.move(id, 'indent')}
                aria-label={`Indent ${item.label}`}
                className={iconButton}
              >
                <CornerDownRight className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => actions.move(id, 'outdent')}
                disabled={!parent}
                aria-label={`Outdent ${item.label}`}
                className={iconButton}
              >
                <CornerLeftUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => actions.remove(id)}
                aria-label={`Remove ${item.label}`}
                className={`${iconButton} hover:text-red-700 dark:hover:text-red-300`}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
});

export default MenuItemRow;
