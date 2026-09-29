'use client';

// Sections panel (spec 038 §11): Header / Template / Footer in page order,
// each item with hide, lock and a ⋯ menu; "Add section" per group lists only
// the sections that group allows and that are under their limit. Every
// canvas action exists here too, for keyboard users (§14).

import { SECTIONS, BLOCKS, sectionsForGroup } from '@jump/theme';
import { Eye, EyeOff, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import ActionsMenu from '@/components/ActionsMenu';
import { usePuck } from './puck';
import { LOCKED } from './config';

const GROUPS = [
  { slot: 'header', label: 'Header' },
  { slot: 'template', label: 'Template' },
  { slot: 'footer', label: 'Footer' },
] as const;

type Item = { type: string; props: Record<string, any> };
const labelOf = (type: string) => (SECTIONS as any)[type]?.label ?? (BLOCKS as any)[type]?.label ?? type;

function Row({ item, index, zone, count, depth }: { item: Item; index: number; zone: string; count: number; depth: number }) {
  const { appState, dispatch } = usePuck();
  const selector = appState.ui.itemSelector;
  const selected = selector?.zone === zone && selector.index === index;
  const locked = LOCKED.has(item.type);
  const label = labelOf(item.type);
  const blocks: Item[] = Array.isArray(item.props.blocks) ? item.props.blocks : [];
  const select = () => dispatch({ type: 'setUi', ui: { itemSelector: { index, zone } } });
  const setHidden = (hidden: boolean) =>
    dispatch({ type: 'replace', destinationIndex: index, destinationZone: zone, data: { ...item, props: { ...item.props, hidden } } } as any);

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${selected ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-gray-50'} ${
          item.props.hidden ? 'opacity-60' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <button type="button" className="min-w-0 flex-1 truncate text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={select} aria-current={selected ? 'true' : undefined}>
          {label}
        </button>
        {locked && <Lock className="h-3.5 w-3.5 text-gray-500" aria-label="Locked" />}
        {!locked && (
          <button
            type="button"
            onClick={() => setHidden(!item.props.hidden)}
            aria-label={`${item.props.hidden ? 'Show' : 'Hide'} ${label}`}
            aria-pressed={Boolean(item.props.hidden)}
            className="rounded p-1 text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {item.props.hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
          </button>
        )}
        {!locked && (
          <ActionsMenu
            label={`More actions for ${label}`}
            items={[
              { label: 'Duplicate', onSelect: () => dispatch({ type: 'duplicate', sourceIndex: index, sourceZone: zone }) },
              {
                label: 'Move up',
                disabled: index === 0,
                onSelect: () => dispatch({ type: 'reorder', sourceIndex: index, destinationIndex: index - 1, destinationZone: zone }),
              },
              {
                label: 'Move down',
                disabled: index >= count - 1,
                onSelect: () => dispatch({ type: 'reorder', sourceIndex: index, destinationIndex: index + 1, destinationZone: zone }),
              },
              {
                label: 'Remove',
                danger: true,
                onSelect: () => {
                  if (blocks.length && !window.confirm(`Remove ${label} and its ${blocks.length} block${blocks.length === 1 ? '' : 's'}?`)) return;
                  dispatch({ type: 'remove', index, zone });
                },
              },
            ]}
          />
        )}
      </div>
      {blocks.length > 0 && (
        <ul>
          {blocks.map((block, i) => (
            <Row key={block.props.id} item={block} index={i} zone={`${item.props.id}:blocks`} count={blocks.length} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AddSection({ slot, items }: { slot: string; items: Item[] }) {
  const { dispatch } = usePuck();
  const [open, setOpen] = useState(false);
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  const choices = (sectionsForGroup(slot) as string[]).filter((type) => {
    const def = (SECTIONS as any)[type];
    return !def.locked && (!def.limit || (counts[type] ?? 0) < def.limit);
  });
  if (!choices.length) return null;
  return (
    <div className="px-2 pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add section
      </button>
      {open && (
        <ul className="mt-1 rounded border border-gray-200 bg-white py-1 shadow-sm" aria-label={`Sections you can add to the ${slot}`}>
          {choices.map((type) => (
            <li key={type}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
                onClick={() => {
                  dispatch({ type: 'insert', componentType: type, destinationIndex: items.length, destinationZone: `root:${slot}` });
                  dispatch({ type: 'setUi', ui: { itemSelector: { index: items.length, zone: `root:${slot}` } } });
                  setOpen(false);
                }}
              >
                {labelOf(type)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SectionsOutline() {
  const { appState } = usePuck();
  const root = appState.data.root.props as Record<string, Item[]>;
  return (
    <nav aria-label="Sections" className="p-2 text-gray-900" data-testid="sections-outline">
      {GROUPS.map((group) => {
        const items = root[group.slot] ?? [];
        return (
          <section key={group.slot} aria-labelledby={`outline-${group.slot}`} className="mb-4">
            <h3 id={`outline-${group.slot}`} className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {group.label}
            </h3>
            <ul>
              {items.map((item, index) => (
                <Row key={item.props.id} item={item} index={index} zone={`root:${group.slot}`} count={items.length} depth={0} />
              ))}
            </ul>
            <AddSection slot={group.slot} items={items} />
          </section>
        );
      })}
    </nav>
  );
}
