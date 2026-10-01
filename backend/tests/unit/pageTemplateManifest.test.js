// Spec 042: page template manifest validation.

import { readFileSync } from 'node:fs';
import {
  parsePageTemplateManifest,
  contactFormSection,
  CONTACT_FORM_DEFAULTS,
} from '../../src/utils/pageTemplateManifest.js';

const contact = JSON.parse(
  readFileSync(new URL('../../../templates/pages/page.contact.json', import.meta.url), 'utf8')
);

const base = (sections, extra = {}) => ({ schemaVersion: 1, name: 'x', label: 'X', sections, ...extra });
const fields = (result) => result.errors.map((e) => e.field);

describe('parsePageTemplateManifest', () => {
  it('accepts the shipped contact template', () => {
    const { manifest, errors } = parsePageTemplateManifest(contact);
    expect(errors).toEqual([]);
    expect(manifest.name).toBe('contact');
    expect(manifest.sections.map((s) => s.type)).toEqual(['page_content', 'contact_form']);
    expect(contactFormSection(manifest).settings).toMatchObject({ showPhone: true, showSubject: true });
  });

  it('fills contact form defaults', () => {
    const { manifest } = parsePageTemplateManifest(
      base([{ type: 'page_content' }, { type: 'contact_form' }])
    );
    expect(contactFormSection(manifest).settings).toEqual(CONTACT_FORM_DEFAULTS);
  });

  it('requires exactly one page_content section', () => {
    expect(fields(parsePageTemplateManifest(base([{ type: 'contact_form' }])))).toContain('sections');
    expect(
      fields(parsePageTemplateManifest(base([{ type: 'page_content' }, { type: 'page_content' }])))
    ).toContain('sections');
  });

  it('allows at most one contact form', () => {
    const result = parsePageTemplateManifest(
      base([{ type: 'page_content' }, { type: 'contact_form' }, { type: 'contact_form' }])
    );
    expect(result.manifest).toBeNull();
    expect(result.errors[0].message).toMatch(/at most one contact_form/);
  });

  it('rejects unknown section types, keys and settings', () => {
    expect(fields(parsePageTemplateManifest(base([{ type: 'page_content' }, { type: 'script' }])))).toContain(
      'sections[1].type'
    );
    expect(fields(parsePageTemplateManifest(base([{ type: 'page_content' }], { css: 'x' })))).toContain('css');
    expect(
      fields(
        parsePageTemplateManifest(
          base([{ type: 'page_content' }, { type: 'contact_form', settings: { onSubmit: 'x' } }])
        )
      )
    ).toContain('sections[1].settings.onSubmit');
    expect(
      fields(
        parsePageTemplateManifest(
          base([{ type: 'page_content' }, { type: 'contact_form', settings: { showPhone: 'yes' } }])
        )
      )
    ).toContain('sections[1].settings.showPhone');
  });

  it('validates name, label and schemaVersion', () => {
    const result = parsePageTemplateManifest({ schemaVersion: 2, name: 'Bad Name', label: '', sections: [{ type: 'page_content' }] });
    expect(fields(result)).toEqual(expect.arrayContaining(['schemaVersion', 'name', 'label']));
  });

  it('sanitizes rich text', () => {
    const { manifest } = parsePageTemplateManifest(
      base([{ type: 'rich_text', settings: { html: '<p onclick="x()">Hi<script>x()</script></p>' } }, { type: 'page_content' }])
    );
    expect(manifest.sections[0].settings.html).toBe('<p>Hi</p>');
  });

  it('caps the manifest size', () => {
    const big = base([{ type: 'page_content' }], { description: 'x'.repeat(70 * 1024) });
    expect(parsePageTemplateManifest(big).errors[0].message).toMatch(/KB or less/);
  });

  it('rejects non-objects', () => {
    expect(parsePageTemplateManifest([]).manifest).toBeNull();
    expect(parsePageTemplateManifest(null).manifest).toBeNull();
  });
});
