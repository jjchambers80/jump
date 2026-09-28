// Spike 038-0: canned theme document and resolved data.

import type { Data } from '@puckeditor/core';
import type { SpikeResolved } from './sections';

export function spikeResolved(orgId = 'org-spike'): SpikeResolved {
  const venue = { id: 'v1', name: 'Riverside Hall', city: 'Durham', state: 'NC', timezone: 'America/New_York' };
  return {
    organization: { id: orgId, slug: orgId, name: 'Riverside Presents', logoUrl: null },
    menus: {
      main: [
        { id: 'm1', label: 'Home', href: `/organizations/${orgId}`, children: [] },
        { id: 'm2', label: 'Events', href: `/organizations/${orgId}/events`, children: [] },
      ],
      footer: [{ id: 'f1', label: 'Contact', href: `/organizations/${orgId}/pages/contact`, children: [] }],
    } as any,
    events: Array.from({ length: 12 }, (_, i) => ({
      id: `e${i}`,
      slug: `show-${i}`,
      name: `Show number ${i + 1}`,
      date: new Date(Date.UTC(2027, 5, 1 + i * 3, 23, 0)).toISOString(),
      venue: venue as any,
      category: 'Music',
      status: 'PUBLISHED',
      admissionMode: 'TICKETED' as const,
      priceRange: { min: 20, max: 45 } as any,
      availableTickets: 40 - i,
    })),
  };
}

/** A home document with `sections` template sections (header + footer extra). */
export function spikeDocument(sections = 4): Data {
  const template: any[] = [];
  for (let i = 0; i < sections; i += 1) {
    const kind = i % 3;
    if (kind === 0) {
      template.push({
        type: 'Hero',
        props: {
          id: `Hero-${i}`,
          heading: `Summer Series ${2027 + i}`,
          subheading: 'Live music by the river, every Friday in June and July. Food trucks, local beer, and no bad seats.',
          paddingTop: 32,
          paddingBottom: 32,
          hidden: false,
          blocks: [
            { type: 'Button', props: { id: `Button-${i}-a`, label: 'Get tickets', href: '/events' } },
            { type: 'Button', props: { id: `Button-${i}-b`, label: 'Learn more', href: '/pages/about' } },
          ],
        },
      });
    } else if (kind === 1) {
      template.push({
        type: 'RichText',
        props: {
          id: `RichText-${i}`,
          heading: `About the series (${i})`,
          body: 'Riverside Presents has run the summer series since 2009. '.repeat(6),
          paddingTop: 32,
          paddingBottom: 32,
          hidden: false,
        },
      });
    } else {
      template.push({ type: 'EventList', props: { id: `EventList-${i}`, limit: 6, paddingTop: 32, paddingBottom: 32, hidden: false } });
    }
  }
  return {
    root: {
      props: {
        title: 'Home',
        header: [
          { type: 'AnnouncementBar', props: { id: 'AnnouncementBar-1', text: 'Early-bird pricing ends Friday', hidden: false } },
          { type: 'Header', props: { id: 'Header-1', sticky: 'off', hidden: false } },
        ],
        template,
        footer: [{ type: 'Footer', props: { id: 'Footer-1', copyright: '', hidden: false } }],
      },
    },
    content: [],
    zones: {},
  } as unknown as Data;
}
