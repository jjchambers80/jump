// RSC-safe Puck config (contracts C12): render functions and slot
// declarations only. The storefront renders it with `Render` from
// `@puckeditor/core/rsc`; the editor (038D) spreads it and adds fields.
// Sections without a component yet (they arrive in 038C/S/E) render nothing.

import type { Config } from '@puckeditor/core';
import AnnouncementBarSection from '../sections/AnnouncementBarSection';
import FooterSection from '../sections/FooterSection';
import HeaderSection from '../sections/HeaderSection';
import { sectionContext } from '../sections/context';

// Puck hands every component its props plus `puck` (metadata) and, for slot
// fields, a render function. Our sections take plain `blocks` arrays, so the
// raw data is read from props before Puck's slot rendering is involved.
type PuckProps = Record<string, any> & { puck: { metadata: Record<string, unknown> } };

export const renderConfig: Config = {
  components: {
    AnnouncementBar: {
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <AnnouncementBarSection {...(props as any)} blocks={blocksOf(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Header: {
      render: ({ puck, ...props }: PuckProps) => <HeaderSection {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Footer: {
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <FooterSection {...(props as any)} blocks={blocksOf(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
  },
};

function blocksOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}
