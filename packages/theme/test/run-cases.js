// Runner shared by the Jest and Vitest suites: `describe/it/expect` come
// from whichever framework imports it.
import { CONTENT_CASES, DOCUMENT_CASES, FILE_ID_CASE, SETTINGS_CASES } from './fixtures/cases.js';
import {
  fileIdsInThemeJson,
  getPreset,
  migrateDocument,
  resolveContent,
  schemeIdsOf,
  translate,
  validateContent,
  validateDocument,
  validateSettings,
  DOCUMENTS,
} from '../src/index.js';

export function runThemeCases({ describe, it, expect }) {
  const preset = getPreset('eventimus-default');
  const schemeIds = schemeIdsOf(preset.settings);

  describe('@jump/theme validateDocument', () => {
    for (const c of DOCUMENT_CASES) {
      it(c.name, () => {
        const { errors } = validateDocument(c.key, c.data, { schemeIds });
        expect(Object.keys(errors).sort()).toEqual([...c.errors].sort());
      });
    }
    it('sanitises rich text through the injected sanitiser', () => {
      const data = { root: { props: {} }, content: [{ type: 'RichText', props: { id: 'R', body: '<p>a</p><script>x</script>' } }] };
      const { value } = validateDocument('home', data, { sanitizeHtml: (html) => html.replace(/<script>.*<\/script>/, '') });
      expect(value.content[0].props.body).toBe('<p>a</p>');
    });
    it('sanitises FAQ answers inside blocks too', () => {
      const data = { root: { props: {} }, content: [{ type: 'Faq', props: { id: 'F', blocks: [{ type: 'FaqItem', props: { id: 'Q', question: 'Why?', answer: '<p>a</p><script>x</script>' } }] } }] };
      const { value, errors } = validateDocument('home', data, { sanitizeHtml: (html) => html.replace(/<script>.*<\/script>/, '') });
      expect(errors).toEqual({});
      expect(value.content[0].props.blocks[0].props.answer).toBe('<p>a</p>');
    });
    it('every preset document validates', () => {
      for (const key of Object.keys(DOCUMENTS)) {
        expect(validateDocument(key, preset.documents[key], { schemeIds }).errors).toEqual({});
      }
    });
  });

  describe('@jump/theme validateSettings', () => {
    for (const c of SETTINGS_CASES) {
      it(c.name, () => {
        expect(Object.keys(validateSettings(c.settings).errors).sort()).toEqual([...c.errors].sort());
      });
    }
    it('preset settings validate', () => {
      expect(validateSettings(preset.settings).errors).toEqual({});
    });
  });

  describe('@jump/theme content catalog', () => {
    for (const c of CONTENT_CASES) {
      it(c.name, () => {
        const { value, errors } = validateContent(c.content);
        expect(Object.keys(errors)).toEqual(c.errors);
        if (c.stored) expect(value).toEqual(c.stored);
      });
    }
    it('translates with variables', () => {
      const content = resolveContent({ 'event.onSaleAt': 'Opens {date}!' });
      expect(translate(content, 'event.onSaleAt', { date: 'Oct 3' })).toBe('Opens Oct 3!');
      expect(translate(content, 'event.soldOut')).toBe('Sold out');
    });
  });

  describe('@jump/theme references and migration', () => {
    it('collects nested and inline file ids', () => {
      expect(fileIdsInThemeJson(FILE_ID_CASE.value).sort()).toEqual([...FILE_ID_CASE.ids].sort());
    });
    it('drops unknown section and block types on read', () => {
      const { data, dropped } = migrateDocument({
        root: { props: {} },
        content: [
          { type: 'Retired', props: { id: 'x' } },
          { type: 'Hero', props: { id: 'h', blocks: [{ type: 'Gone', props: { id: 'g' } }, { type: 'Button', props: { id: 'b' } }] } },
        ],
      });
      expect(dropped).toEqual(['Retired', 'Gone']);
      expect(data.content).toHaveLength(1);
      expect(data.content[0].props.blocks.map((b) => b.type)).toEqual(['Button']);
    });
  });
}
