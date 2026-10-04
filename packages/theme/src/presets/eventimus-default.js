// "Eventimus Default" (spec 038 §6.4). Reproduces today's storefront: the
// events document is today's organization home (cover + next-event overlay +
// events grouped by month), scheme 1 follows the org brand color and the
// page's light/dark tokens (D7), and the announcement bar ships hidden.

export const preset = {
  key: 'eventimus-default',
  name: 'Eventimus Default',
  version: '1.0',
  description: 'Clean event listings with your brand color.',
};

export const settings = {
  colors: {
    schemes: [
      {
        id: 'scheme-1',
        name: 'Page',
        background: 'auto',
        foreground: 'auto',
        accent: 'brand',
        accentForeground: 'auto',
        secondaryButtonLabel: 'auto',
        border: 'auto',
        muted: 'auto',
        shadow: 'auto',
      },
      {
        id: 'scheme-2',
        name: 'Inverse',
        background: '#111827',
        foreground: '#f9fafb',
        accent: 'brand',
        accentForeground: 'auto',
        secondaryButtonLabel: '#f9fafb',
        border: '#374151',
        muted: '#9ca3af',
        shadow: '#000000',
      },
    ],
  },
};

export const content = {};

export const documents = {
  header: {
    root: { props: {} },
    content: [
      {
        type: 'AnnouncementBar',
        props: {
          id: 'AnnouncementBar-default',
          hidden: true,
          blocks: [{ type: 'Announcement', props: { id: 'Announcement-default', text: 'Tickets on sale now' } }],
        },
      },
      { type: 'Header', props: { id: 'Header-default' } },
    ],
  },
  footer: {
    root: { props: {} },
    content: [{ type: 'Footer', props: { id: 'Footer-default', blocks: [] } }],
  },
  events: {
    root: { props: { title: 'Events' } },
    content: [
      { type: 'EventsHero', props: { id: 'EventsHero-default' } },
      { type: 'EventList', props: { id: 'EventList-default', layout: 'grouped' } },
    ],
  },
  home: {
    root: { props: { title: 'Home' } },
    content: [
      {
        type: 'Hero',
        props: {
          id: 'Hero-default',
          heading: 'Welcome',
          subheading: 'Find your next night out.',
          blocks: [{ type: 'Button', props: { id: 'Button-default', label: 'See all events', link: { type: 'EVENTS' } } }],
        },
      },
      { type: 'UpcomingEvents', props: { id: 'UpcomingEvents-default' } },
      { type: 'CallToAction', props: { id: 'CallToAction-default', blocks: [] } },
    ],
  },
};
