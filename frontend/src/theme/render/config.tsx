// RSC-safe Puck config (contracts C12): render functions and slot
// declarations only. The storefront renders it with `Render` from
// `@puckeditor/core/rsc`; the editor (038D) spreads it and adds fields.
// Sections without a component yet render nothing (`renderable` drops them).

import type { Config } from '@puckeditor/core';
import AnnouncementBarSection from '../sections/AnnouncementBarSection';
import FooterSection from '../sections/FooterSection';
import HeaderSection from '../sections/HeaderSection';
import EventsHeroSection from '../sections/EventsHeroSection';
import EventListSection from '../sections/EventListSection';
import ButtonBlock from '../sections/ButtonBlock';
import CallToActionSection from '../sections/CallToActionSection';
import SpotlightSection from '../sections/SpotlightSection';
import FaqItemBlock from '../sections/FaqItemBlock';
import FaqSection from '../sections/FaqSection';
import HeroCarouselSection from '../sections/HeroCarouselSection';
import HeroSection from '../sections/HeroSection';
import SlideBlock from '../sections/SlideBlock';
import RichTextSection from '../sections/RichTextSection';
import UpcomingEventsSection from '../sections/UpcomingEventsSection';
import GallerySection from '../sections/GallerySection';
import PageContentSection from '../sections/PageContentSection';
import ImageWithTextSection from '../sections/ImageWithTextSection';
import FeatureGridSection from '../sections/FeatureGridSection';
import FeatureBlock from '../sections/FeatureBlock';
import StatsSection from '../sections/StatsSection';
import StatBlock from '../sections/StatBlock';
import ChecklistSection from '../sections/ChecklistSection';
import ChecklistItemBlock from '../sections/ChecklistItemBlock';
import StepsSection from '../sections/StepsSection';
import StepBlock from '../sections/StepBlock';
import TiersSection from '../sections/TiersSection';
import TierBlock from '../sections/TierBlock';
import { sectionContext } from '../sections/context';

// Puck hands every component its props plus `puck` (metadata) and, for slot
// fields, a render function. Template sections declare `blocks` as a slot so
// Puck renders their Button blocks (and the editor can select them); header
// and footer blocks are data their section lays out itself.
type PuckProps = Record<string, any> & { puck: { metadata: Record<string, unknown> } };

const buttonsSlot = { type: 'slot' as const, allow: ['Button'] };

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
    EventsHero: {
      render: ({ puck, ...props }: PuckProps) => <EventsHeroSection {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    EventList: {
      render: ({ puck, ...props }: PuckProps) => <EventListSection {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Hero: {
      fields: { blocks: buttonsSlot },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <HeroSection {...(props as any)} Buttons={slotWrapper(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    RichText: {
      fields: { blocks: buttonsSlot },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <RichTextSection {...(props as any)} Buttons={slotWrapper(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    CallToAction: {
      fields: { blocks: buttonsSlot },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <CallToActionSection {...(props as any)} Buttons={slotWrapper(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Spotlight: {
      fields: { blocks: buttonsSlot },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <SpotlightSection {...(props as any)} Buttons={slotWrapper(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    HeroCarousel: {
      fields: { blocks: { type: 'slot', allow: ['Slide'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <HeroCarouselSection {...(props as any)} Slides={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Slide: {
      render: ({ puck, ...props }: PuckProps) => <SlideBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Faq: {
      fields: { blocks: { type: 'slot', allow: ['FaqItem'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <FaqSection {...(props as any)} Items={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    FaqItem: {
      render: ({ puck, ...props }: PuckProps) => <FaqItemBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    UpcomingEvents: {
      render: ({ puck, ...props }: PuckProps) => <UpcomingEventsSection {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Gallery: {
      render: ({ puck, ...props }: PuckProps) => <GallerySection {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    ImageWithText: {
      fields: { blocks: buttonsSlot },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <ImageWithTextSection {...(props as any)} Buttons={slotWrapper(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    FeatureGrid: {
      fields: { blocks: { type: 'slot', allow: ['Feature'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <FeatureGridSection {...(props as any)} Items={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Feature: {
      render: ({ puck, ...props }: PuckProps) => <FeatureBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Stats: {
      fields: { blocks: { type: 'slot', allow: ['Stat'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <StatsSection {...(props as any)} Items={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Stat: {
      render: ({ puck, ...props }: PuckProps) => <StatBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Checklist: {
      fields: { blocks: { type: 'slot', allow: ['ChecklistItem'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <ChecklistSection {...(props as any)} Items={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    ChecklistItem: {
      render: ({ puck, ...props }: PuckProps) => <ChecklistItemBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Steps: {
      fields: { blocks: { type: 'slot', allow: ['Step'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <StepsSection {...(props as any)} Items={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Step: {
      render: ({ puck, ...props }: PuckProps) => <StepBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Tiers: {
      fields: { blocks: { type: 'slot', allow: ['Tier'] } },
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <TiersSection {...(props as any)} Items={slotRender(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
    Tier: {
      render: ({ puck, ...props }: PuckProps) => <TierBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    PageContent: {
      render: ({ puck, ...props }: PuckProps) => <PageContentSection {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Button: {
      render: ({ puck, ...props }: PuckProps) => <ButtonBlock {...(props as any)} ctx={sectionContext(puck.metadata)} />,
    },
    Footer: {
      render: ({ puck, blocks, ...props }: PuckProps) => (
        <FooterSection {...(props as any)} blocks={blocksOf(blocks)} ctx={sectionContext(puck.metadata)} />
      ),
    },
  },
};

/**
 * The slot renders its own wrapper element, so layout classes go on it
 * (contracts C12). `empty:hidden` drops the wrapper's spacing when every
 * button is gone (no buttons, or targets that no longer resolve).
 */
function slotWrapper(Slot: unknown) {
  const Render = typeof Slot === 'function' ? (Slot as (p?: { className?: string }) => JSX.Element) : null;
  return function Buttons({ className = '' }: { className?: string } = {}) {
    return Render ? <Render className={`${className} empty:hidden`} /> : null;
  };
}

/** A slot the section lays out itself (track, list): class, style and drag axis pass through. */
function slotRender(Slot: unknown) {
  const Render = typeof Slot === 'function' ? (Slot as (p?: Record<string, unknown>) => JSX.Element) : null;
  return function SlotItems(props: Record<string, unknown> = {}) {
    return Render ? <Render {...props} /> : null;
  };
}

function blocksOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}

/** A document with only the section types this config can render. */
export function renderable<T extends { content: { type: string }[] }>(doc: T): T {
  return { ...doc, content: doc.content.filter((item) => item.type in renderConfig.components) };
}
