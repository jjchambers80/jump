// Spike 038-0: RSC-safe Puck config. Imported by the server Render and
// spread by the editor config. Only render functions and slot declarations
// (Render needs to know which props are slots); editor fields live in
// config.editor.tsx so nothing editor-only reaches the storefront bundle.

import type { Config } from '@puckeditor/core';
import {
  AnnouncementBarSection,
  ButtonBlock,
  EventListSection,
  FooterSection,
  HeaderSection,
  HeroSection,
  RichTextSection,
  type SpikeResolved,
} from './sections';

export const HEADER_GROUP = ['AnnouncementBar', 'Header'];
export const TEMPLATE_GROUP = ['Hero', 'RichText', 'EventList'];
export const FOOTER_GROUP = ['Footer'];
export const LOCKED = new Set(['Header', 'Footer', 'EventList']);

const resolvedOf = (metadata: Record<string, unknown>) => metadata.resolved as SpikeResolved;

export const renderConfig: Config = {
  root: {
    fields: {
      header: { type: 'slot', allow: HEADER_GROUP },
      template: { type: 'slot', allow: TEMPLATE_GROUP },
      footer: { type: 'slot', allow: FOOTER_GROUP },
    },
    render: ({ header: Header, template: Template, footer: Footer }: any) => (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
        <Header />
        <main id="main" className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--theme-section-gap, 0px)' }}>
          <Template />
        </main>
        <Footer />
      </div>
    ),
  },
  components: {
    AnnouncementBar: {
      render: ({ text }: any) => <AnnouncementBarSection text={text} />,
    },
    Header: {
      render: ({ sticky, puck }: any) => <HeaderSection resolved={resolvedOf(puck.metadata)} sticky={sticky} />,
    },
    Hero: {
      fields: { blocks: { type: 'slot', allow: ['Button'] } },
      render: ({ heading, subheading, paddingTop, paddingBottom, blocks }: any) => (
        <HeroSection heading={heading} subheading={subheading} paddingTop={paddingTop} paddingBottom={paddingBottom} Blocks={blocks} />
      ),
    },
    Button: {
      inline: false,
      render: ({ label, href }: any) => <ButtonBlock label={label} href={href} />,
    },
    RichText: {
      render: ({ heading, body }: any) => <RichTextSection heading={heading} body={body} />,
    },
    EventList: {
      render: ({ limit, puck }: any) => <EventListSection resolved={resolvedOf(puck.metadata)} limit={limit} />,
    },
    Footer: {
      render: ({ copyright, puck }: any) => <FooterSection resolved={resolvedOf(puck.metadata)} copyright={copyright} />,
    },
  },
};
