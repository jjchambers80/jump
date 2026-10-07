'use client';

// Editor Puck config (contracts C12): the storefront's RSC-safe render config
// plus fields generated from the @jump/theme registry, defaults, lock rules
// and editor-only wrappers (hidden sections dimmed, header/footer blocks as
// array fields). Render functions are the storefront's own, so the canvas
// shows exactly what the store will.

import { BLOCKS, COMMON_SECTION_FIELDS, DOCUMENTS, SECTIONS, fieldDefaults, sectionsForDocument, sectionsForGroup } from '@jump/theme';
import { EyeOff } from 'lucide-react';
import { renderConfig } from '../render/config';
import ThemeScope from '../ThemeScope';
import RetroGridBackground from '../RetroGridBackground';
import { pageWidthVars, schemeCss, settingsVars } from '../settingsCss';
import { sectionContext } from '../sections/context';
import { createUsePuck, type Config, type Fields } from './puck';
import { puckField, type FieldContext, type FieldSpec } from './fields';
import { AnnouncementsList, FooterColumnsList } from './ListFields';

export const LOCKED = new Set(Object.entries(SECTIONS).filter(([, def]: [string, any]) => def.locked).map(([type]) => type));

const specsToFields = (specs: Record<string, FieldSpec>, ctx: FieldContext) =>
  Object.fromEntries(Object.entries(specs).map(([key, spec]) => [key, puckField(spec, ctx)])) as Fields;

function blockArrayField(type: string): Fields {
  if (type === 'AnnouncementBar') {
    return {
      announcements: {
        type: 'custom',
        label: 'Announcements',
        render: ({ value, onChange }: any) => <AnnouncementsList value={value} onChange={onChange} />,
      },
    } as unknown as Fields;
  }
  if (type === 'Footer') {
    return {
      columns: {
        type: 'custom',
        label: 'Footer columns',
        render: ({ value, onChange }: any) => <FooterColumnsList value={value} onChange={onChange} />,
      },
    } as unknown as Fields;
  }
  return {};
}

/** Array-field rows back into the blocks the storefront section expects. */
function editorProps(type: string, props: Record<string, any>) {
  const { announcements, columns, ...rest } = props;
  if (type === 'AnnouncementBar') {
    return {
      ...rest,
      blocks: (announcements ?? [])
        .filter((row: any) => !row.hidden)
        .map((row: any, i: number) => ({ type: 'Announcement', props: { ...row, id: row.id || `new-${i}` } })),
    };
  }
  if (type === 'Footer') {
    return {
      ...rest,
      blocks: (columns ?? [])
        .filter((row: any) => !row.hidden)
        .map((row: any, i: number) => ({ type: row.kind || 'Text', props: { ...row, id: row.id || `new-${i}` } })),
    };
  }
  return rest;
}

/**
 * Blocks the canvas brings into view when selected: the carousel scrolls to
 * the slide, the FAQ opens the question (spec 041). They get `editorSelected`.
 */
const FOLLOWS_SELECTION = new Set(['Slide', 'FaqItem']);
const useSelectedId = createUsePuck();

function followSelection(render: (props: any) => JSX.Element) {
  return function Selectable(props: any) {
    const selectedId = useSelectedId((s) => (s.selectedItem?.props as { id?: string } | undefined)?.id);
    return render({ ...props, editorSelected: selectedId === props.id });
  };
}

/** What a block added from the Sections panel starts with. */
export const STARTER_BLOCK_PROPS: Record<string, Record<string, unknown>> = {
  Slide: { heading: 'New slide' },
  FaqItem: { question: 'New question' },
  Feature: { title: 'New feature' },
  Stat: { value: '100+', label: 'New stat' },
  ChecklistItem: { text: 'New item' },
  Step: { title: 'New step' },
  Tier: { name: 'New tier' },
  Button: { label: 'Get tickets', link: { type: 'EVENTS' } },
};

/** What a freshly added section starts with, so it is never an empty box. */
const STARTER_BLOCKS: Record<string, { type: string; props: Record<string, unknown> }[]> = {
  HeroCarousel: [
    { type: 'Slide', props: { heading: 'Your next big show', subheading: 'Add an image, a line of text and a button.' } },
    { type: 'Slide', props: { heading: 'Another highlight' } },
  ],
  FeatureGrid: [
    { type: 'Feature', props: { title: 'Great shows', text: 'Something on every weekend.' } },
    { type: 'Feature', props: { title: 'Easy tickets', text: 'Buy in a minute, scan at the door.' } },
    { type: 'Feature', props: { title: 'Friendly venue', text: 'Free parking and step-free access.' } },
  ],
  Stats: [
    { type: 'Stat', props: { value: '25,000+', label: 'Guests a year' } },
    { type: 'Stat', props: { value: '40', label: 'Shows a year' } },
    { type: 'Stat', props: { value: '10', label: 'Years running' } },
  ],
  Checklist: [
    { type: 'ChecklistItem', props: { text: 'A photo ID' } },
    { type: 'ChecklistItem', props: { text: 'Your ticket, on your phone or printed' } },
  ],
  Steps: [
    { type: 'Step', props: { title: 'Apply', text: '<p>Fill in the form for the event you want.</p>' } },
    { type: 'Step', props: { title: 'Get approved', text: '<p>We review every application by hand.</p>' } },
    { type: 'Step', props: { title: 'Show up', text: '<p>Load in, set up and meet the crowd.</p>' } },
  ],
  Tiers: [
    { type: 'Tier', props: { name: 'Standard', benefits: 'Your logo on the event page\nTwo tickets' } },
    { type: 'Tier', props: { name: 'Premium', featured: true, badge: 'Most popular', benefits: 'Everything in Standard\nA booth at the event\nSix tickets' } },
  ],
  Faq: [
    { type: 'FaqItem', props: { question: 'When do doors open?', answer: '<p>Doors open one hour before the show.</p>' } },
    { type: 'FaqItem', props: { question: 'Can I get a refund?', answer: '<p>See the refund policy on your ticket.</p>' } },
  ],
};

/** `page`: the template document being edited; a Content page also takes Page content. */
export function buildEditorConfig(ctx: FieldContext, page = 'home'): Config {
  const components: Config['components'] = {};
  for (const [type, base] of Object.entries(renderConfig.components)) {
    const section = (SECTIONS as Record<string, any>)[type];
    const block = (BLOCKS as Record<string, any>)[type];
    const def = section ?? block;
    if (!def) continue;
    const specs: Record<string, FieldSpec> = section ? { ...def.settings, ...COMMON_SECTION_FIELDS } : def.settings;
    const plainRender = base.render as (props: any) => JSX.Element;
    const baseRender = FOLLOWS_SELECTION.has(type) ? followSelection(plainRender) : plainRender;
    components[type] = {
      label: def.label,
      fields: {
        ...specsToFields(specs, ctx),
        ...blockArrayField(type),
        ...(base.fields ?? {}),
      },
      defaultProps: {
        ...fieldDefaults(specs),
        ...(block ? (STARTER_BLOCK_PROPS[type] ?? {}) : {}),
        ...(type === 'AnnouncementBar' ? { announcements: [] } : {}),
        ...(type === 'Footer' ? { columns: [] } : {}),
        ...((base.fields as Record<string, unknown> | undefined)?.blocks ? { blocks: STARTER_BLOCKS[type] ?? [] } : {}),
      },
      permissions: LOCKED.has(type) ? { drag: false, duplicate: false, delete: false } : undefined,
      render: ({ hidden, ...props }: any) => {
        const Render = baseRender;
        const out = FOLLOWS_SELECTION.has(type) ? <Render {...editorProps(type, props)} /> : baseRender(editorProps(type, props));
        if (!hidden) return out;
        return (
          <div data-hidden-section className="relative opacity-40">
            <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded bg-gray-900 px-2 py-0.5 text-xs text-white">
              <EyeOff className="h-3 w-3" aria-hidden /> Hidden
            </span>
            {out}
          </div>
        );
      },
    };
  }

  return {
    root: {
      fields: {
        title: { type: 'text', label: 'Page title' },
        seoTitle: { type: 'text', label: 'SEO title' },
        seoDescription: { type: 'textarea', label: 'SEO description' },
        pageWidth: puckField((DOCUMENTS as any).home.root.pageWidth, ctx),
        header: { type: 'slot', allow: sectionsForGroup('header') },
        template: { type: 'slot', allow: sectionsForDocument(page) },
        footer: { type: 'slot', allow: sectionsForGroup('footer') },
      } as Fields,
      render: ({ header: Header, template: Template, footer: Footer, pageWidth, puck }: any) => {
        const section = sectionContext(puck.metadata);
        const dark = section.organization.themeMode === 'DARK';
        // staticMode: no mode script and no ThemeModeSync, which would force
        // the admin page's own theme from inside the canvas.
        return (
          <div className={dark ? 'dark' : undefined}>
            <ThemeScope
              brandColor={section.organization.brandColor}
              themeMode={section.organization.themeMode}
              vars={settingsVars(section.settings)}
              css={schemeCss(section.settings)}
              staticMode
              className="min-h-screen bg-gray-50 dark:bg-slate-900"
            >
              <RetroGridBackground settings={section.settings} />
              <div className="relative" style={pageWidthVars({ props: { pageWidth } })}>
                <Header />
                <main>
                  <Template />
                </main>
                <Footer />
              </div>
            </ThemeScope>
          </div>
        );
      },
    },
    components,
  };
}
