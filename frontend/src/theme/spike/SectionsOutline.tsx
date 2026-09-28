'use client';

// Spike 038-0: Jump's own outline in the plugin rail. Puck's outline lists
// root slots in reverse and shows the unused `default-zone`; this one shows
// Header / Template / Footer in page order with eye, lock and ⋯ actions.
// Every canvas action also exists here for keyboard users (§14).

import { usePuck } from '@puckeditor/core';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { LOCKED } from './config.render';

const GROUPS = [
  { slot: 'header', label: 'Header' },
  { slot: 'template', label: 'Template' },
  { slot: 'footer', label: 'Footer' },
] as const;

type Item = { type: string; props: Record<string, any> };

function Row({ item, index, zone, depth }: { item: Item; index: number; zone: string; depth: number }) {
  const { appState, dispatch, config } = usePuck();
  const selector = appState.ui.itemSelector;
  const selected = selector?.zone === zone && selector.index === index;
  const locked = LOCKED.has(item.type);
  const label = (config.components[item.type] as any)?.label ?? item.type;
  const count = zone.startsWith('root:') ? ((appState.data.root.props as any)[zone.slice(5)] ?? []).length : 0;
  const blocks: Item[] = Array.isArray(item.props.blocks) ? item.props.blocks : [];

  const select = () => dispatch({ type: 'setUi', ui: { itemSelector: { index, zone } } });
  const toggleHidden = () =>
    dispatch({
      type: 'replace',
      destinationIndex: index,
      destinationZone: zone,
      data: { ...item, props: { ...item.props, hidden: !item.props.hidden } },
    } as any);

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${selected ? 'bg-blue-50 text-blue-900' : 'hover:bg-gray-50'} ${item.props.hidden ? 'opacity-60' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <button type="button" className="flex-1 text-left truncate" onClick={select} aria-current={selected ? 'true' : undefined}>
          {label}
        </button>
        {locked && <Lock size={14} aria-label="Locked" />}
        {'hidden' in item.props && (
          <button type="button" onClick={toggleHidden} aria-label={`${item.props.hidden ? 'Show' : 'Hide'} ${label}`} aria-pressed={!!item.props.hidden}>
            {item.props.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        {!locked && (
          <details className="relative">
            <summary className="list-none cursor-pointer px-1" aria-label={`More actions for ${label}`}>⋯</summary>
            <div className="absolute right-0 z-10 mt-1 w-36 rounded border bg-white p-1 shadow" role="menu">
              <button role="menuitem" type="button" className="block w-full px-2 py-1 text-left" disabled={index === 0}
                onClick={() => dispatch({ type: 'reorder', sourceIndex: index, destinationIndex: index - 1, destinationZone: zone })}>Move up</button>
              <button role="menuitem" type="button" className="block w-full px-2 py-1 text-left" disabled={index >= count - 1}
                onClick={() => dispatch({ type: 'reorder', sourceIndex: index, destinationIndex: index + 1, destinationZone: zone })}>Move down</button>
              <button role="menuitem" type="button" className="block w-full px-2 py-1 text-left"
                onClick={() => dispatch({ type: 'duplicate', sourceIndex: index, sourceZone: zone })}>Duplicate</button>
              <button role="menuitem" type="button" className="block w-full px-2 py-1 text-left text-red-700"
                onClick={() => dispatch({ type: 'remove', index, zone })}>Remove</button>
            </div>
          </details>
        )}
      </div>
      {blocks.length > 0 && (
        <ul>
          {blocks.map((block, i) => (
            <Row key={block.props.id} item={block} index={i} zone={`${item.props.id}:blocks`} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SectionsOutline() {
  const { appState } = usePuck();
  const root = appState.data.root.props as Record<string, Item[]>;
  return (
    <nav aria-label="Sections" className="p-2" data-testid="sections-outline">
      {GROUPS.map((group) => (
        <section key={group.slot} aria-labelledby={`outline-${group.slot}`} className="mb-3">
          <h3 id={`outline-${group.slot}`} className="px-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {group.label}
          </h3>
          <ul>
            {(root[group.slot] ?? []).map((item, index) => (
              <Row key={item.props.id} item={item} index={index} zone={`root:${group.slot}`} depth={0} />
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
