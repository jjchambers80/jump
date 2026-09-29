// Spec 038D: editor tree ⇄ theme documents must round-trip exactly, and every
// preset document must survive it unchanged (the server validates the result).
import { describe, expect, it } from 'vitest';
import { getPreset, validateDocument, schemeIdsOf } from '@jump/theme';
import { fromEditorData, toEditorData } from '@/theme/editor/data';

const preset = getPreset('eventimus-default');

describe('editor data', () => {
  it('round-trips the preset documents for both pages', () => {
    for (const key of ['home', 'events'] as const) {
      const docs = { header: preset.documents.header, footer: preset.documents.footer, template: preset.documents[key] };
      const back = fromEditorData(toEditorData(docs) as any);
      expect(back.header).toEqual(preset.documents.header);
      expect(back.footer).toEqual(preset.documents.footer);
      expect(back.template).toEqual(preset.documents[key]);
    }
  });

  it('flattens announcements and footer columns into array fields and rebuilds them', () => {
    const header = {
      root: { props: {} },
      content: [
        { type: 'AnnouncementBar', props: { id: 'AB', rotate: '5s', blocks: [{ type: 'Announcement', props: { id: 'A1', text: 'Hi', link: { type: 'EVENTS' } } }] } },
        { type: 'Header', props: { id: 'H' } },
      ],
    };
    const footer = {
      root: { props: {} },
      content: [{ type: 'Footer', props: { id: 'F', blocks: [{ type: 'Text', props: { id: 'T', heading: 'About', body: '<p>x</p>' } }] } }],
    };
    const editor = toEditorData({ header, footer, template: preset.documents.events });
    expect(editor.root.props.header[0].props.announcements).toEqual([{ id: 'A1', text: 'Hi', link: { type: 'EVENTS' } }]);
    expect(editor.root.props.footer[0].props.columns).toEqual([{ id: 'T', kind: 'Text', heading: 'About', body: '<p>x</p>' }]);

    // The editor adds rows without ids and leaves null dates behind.
    editor.root.props.header[0].props.announcements.push({ text: 'New', link: null, startsAt: null, endsAt: null });
    editor.root.props.footer[0].props.columns.push({ kind: 'SocialLinks' });
    const back = fromEditorData(editor);
    const blocks = back.header.content[0].props.blocks;
    expect(blocks[1]).toMatchObject({ type: 'Announcement', props: { text: 'New' } });
    expect(blocks[1].props.id).toMatch(/^Announcement-/);
    expect(blocks[1].props).not.toHaveProperty('startsAt');
    expect(back.footer.content[0].props.blocks[1].type).toBe('SocialLinks');
    const schemeIds = schemeIdsOf(preset.settings);
    expect(validateDocument('header', back.header, { schemeIds }).errors).toEqual({});
    expect(validateDocument('footer', back.footer, { schemeIds }).errors).toEqual({});
  });

  it('keeps page root props (title, SEO) with the template only', () => {
    const template = { root: { props: { title: 'Home', seoTitle: 'Riverside' } }, content: [] };
    const back = fromEditorData(toEditorData({ header: preset.documents.header, footer: preset.documents.footer, template }) as any);
    expect(back.template.root.props).toEqual({ title: 'Home', seoTitle: 'Riverside' });
    expect(back.header.root.props).toEqual({});
  });
});
