'use client';

// Spike 038-0: editor config = render config + fields, defaults and
// permissions. Locked sections cannot be dragged, duplicated or deleted.

import type { Config } from '@puckeditor/core';
import { renderConfig, LOCKED } from './config.render';

const common = {
  hidden: { type: 'radio' as const, label: 'Visibility', options: [{ label: 'Shown', value: false }, { label: 'Hidden', value: true }] },
  paddingTop: { type: 'number' as const, label: 'Top padding', min: 0, max: 80 },
  paddingBottom: { type: 'number' as const, label: 'Bottom padding', min: 0, max: 80 },
};

const locked = { drag: false, duplicate: false, delete: false };

function withHidden(type: string, component: any) {
  const render = component.render;
  return {
    ...component,
    permissions: LOCKED.has(type) ? locked : undefined,
    render: (props: any) => {
      if (props.hidden && !props.puck?.isEditing) return <></>;
      const out = render(props);
      return props.hidden ? <div style={{ opacity: 0.35 }} data-hidden-section>{out}</div> : out;
    },
  };
}

const editorComponents: Record<string, any> = {
  AnnouncementBar: {
    label: 'Announcement bar',
    fields: { text: { type: 'text', label: 'Text' }, hidden: common.hidden },
    defaultProps: { text: 'Summer Series tickets on sale now', hidden: false },
  },
  Header: {
    label: 'Header',
    fields: {
      sticky: { type: 'select', label: 'Sticky header', options: [{ label: 'Off', value: 'off' }, { label: 'Always', value: 'always' }, { label: 'On scroll up', value: 'scroll-up' }] },
    },
    defaultProps: { sticky: 'off', hidden: false },
  },
  Hero: {
    label: 'Hero',
    fields: {
      heading: { type: 'text', label: 'Heading' },
      subheading: { type: 'textarea', label: 'Subheading' },
      ...common,
      blocks: { type: 'slot', allow: ['Button'] },
    },
    defaultProps: { heading: 'Summer Series 2027', subheading: 'Live music by the river', paddingTop: 32, paddingBottom: 32, hidden: false, blocks: [] },
  },
  Button: {
    label: 'Button',
    fields: { label: { type: 'text', label: 'Label' }, href: { type: 'text', label: 'Link' } },
    defaultProps: { label: 'Get tickets', href: '/events' },
  },
  RichText: {
    label: 'Rich text',
    fields: { heading: { type: 'text', label: 'Heading' }, body: { type: 'textarea', label: 'Body' }, ...common },
    defaultProps: { heading: 'About us', body: 'We run the best shows in town.', paddingTop: 32, paddingBottom: 32, hidden: false },
  },
  EventList: {
    label: 'Event list',
    fields: { limit: { type: 'number', label: 'Events shown', min: 1, max: 48 }, ...common },
    defaultProps: { limit: 12, paddingTop: 32, paddingBottom: 32, hidden: false },
  },
  Footer: {
    label: 'Footer',
    fields: { copyright: { type: 'text', label: 'Copyright text' } },
    defaultProps: { copyright: '', hidden: false },
  },
};

export const editorConfig: Config = {
  root: { ...renderConfig.root, fields: { ...renderConfig.root!.fields } },
  components: Object.fromEntries(
    Object.entries(renderConfig.components).map(([type, component]) => [
      type,
      withHidden(type, { ...component, ...editorComponents[type], render: component.render }),
    ]),
  ),
};
