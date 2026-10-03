// Theme code editor files (Online Store › Edit code): parse, check, locate,
// and build the same save body the CLI pushes.

import { describe, expect, it } from 'vitest';
import { getPreset } from '@jump/theme';
import { checkTexts, docPath, filesToTexts, parseTexts, rangeFor, saveBody, splitPath, SCHEMA_PATH, type ThemeFiles } from '@/theme/code/files';

const preset = getPreset('eventimus-default');
const original: ThemeFiles = { settings: {}, content: {}, documents: structuredClone(preset.documents) };
const versions = { header: 2, footer: 0, home: 5, events: 0 };

describe('theme code files', () => {
  it('lays out the files like `jump theme pull`, schema included', () => {
    const texts = filesToTexts(original);
    expect(Object.keys(texts)).toEqual(['settings.json', 'content.json', docPath('header'), docPath('footer'), docPath('home'), docPath('events'), SCHEMA_PATH]);
    expect(JSON.parse(texts[SCHEMA_PATH]).commonSectionFields.sectionWidth.options).toContain('full');
    expect(parseTexts(texts).files).toEqual(original);
  });

  it('saves only what changed, with the versions it was opened at', () => {
    const edited = structuredClone(original);
    edited.documents.home.content[0].props.sectionWidth = 'full';
    expect(saveBody(original, edited, versions, 7)).toEqual({ themeVersion: 7, documents: { home: { data: edited.documents.home, version: 5 } } });
    edited.settings = { layout: { pageWidth: 1400 } };
    expect(saveBody(original, edited, versions, 7)?.settings).toEqual({ layout: { pageWidth: 1400 } });
    expect(saveBody(original, structuredClone(original), versions, 7)).toBeNull();
  });

  it('reports bad JSON once and validator problems per file', () => {
    const texts = filesToTexts(original);
    texts['settings.json'] = '{ "layout": ';
    const home = structuredClone(original.documents.home);
    home.content[0].props.sectionWidth = 'huge';
    home.content.push({ type: 'Script', props: { id: 'S' } } as any);
    texts[docPath('home')] = JSON.stringify(home, null, 2);
    const problems = checkTexts(texts, 'eventimus-default');
    expect(problems.filter((p) => p.path === 'settings.json')).toEqual([expect.objectContaining({ message: 'is not valid JSON' })]);
    const onHome = problems.filter((p) => p.path === docPath('home')).map((p) => p.at);
    expect(onHome).toContainEqual(['content', 0, 'props', 'sectionWidth']);
    expect(onHome).toContainEqual(['content', home.content.length - 1, 'type']);
  });

  it('keeps dotted content keys whole', () => {
    const texts = filesToTexts(original);
    texts['content.json'] = JSON.stringify({ 'events.upcoming': 'x'.repeat(5000) });
    const problem = checkTexts(texts, 'eventimus-default').find((p) => p.path === 'content.json');
    expect(problem?.at).toEqual(['events.upcoming']);
  });

  it('finds the key of a nested path, or its nearest parent', () => {
    const text = '{\n  "content": [\n    { "type": "Hero", "props": { "id": "H", "sectionWidth": "huge" } }\n  ]\n}\n';
    const at = rangeFor(text, { path: 'x', at: splitPath('content[0].props.sectionWidth'), message: '' });
    expect(text.slice(at.offset, at.offset + at.length)).toBe('"sectionWidth"');
    const parent = rangeFor(text, { path: 'x', at: splitPath('content[0].props.missing'), message: '' });
    expect(text.slice(parent.offset, parent.offset + parent.length)).toBe('"props"');
  });
});
