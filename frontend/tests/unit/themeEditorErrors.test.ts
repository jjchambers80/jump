import { describe, expect, it } from 'vitest';
import { describeDocumentError, describeSaveError } from '@/theme/editor/errors';

const home = {
  root: { props: {} },
  content: [
    { type: 'Hero', props: { id: 'H', blocks: [{ type: 'Button', props: { id: 'B1' } }, { type: 'Button', props: { id: 'B2' } }] } },
    { type: 'RichText', props: { id: 'R' } },
  ],
};

describe('theme editor error messages', () => {
  it('names the page, section and field', () => {
    expect(describeSaveError('documents.home.content[0].props.image', 'needs alt text, or mark it decorative', { home })).toBe(
      'Home page › Hero › Image: needs alt text, or mark it decorative',
    );
  });
  it('names nested blocks by position', () => {
    expect(describeDocumentError('home', 'content[0].props.blocks[1].props.link', 'url must start with https://', home)).toBe(
      'Home page › Hero › Button 2 › Link: url must start with https://',
    );
  });
  it('handles common fields, root fields and whole-document errors', () => {
    expect(describeDocumentError('home', 'content[1].props.paddingTop', 'must be between 0 and 80', home)).toBe(
      'Home page › Rich text › Top padding: must be between 0 and 80',
    );
    expect(describeDocumentError('home', 'root.props.seoTitle', 'must be at most 70 characters', home)).toBe(
      'Home page › SEO title: must be at most 70 characters',
    );
    expect(describeSaveError('documents.events', 'uses scheme-2, which the new settings remove', {})).toBe(
      'Events page: uses scheme-2, which the new settings remove',
    );
    expect(describeSaveError('settings.layout.pageWidth', 'must be between 1000 and 1600', {})).toBe(
      'settings.layout.pageWidth: must be between 1000 and 1600',
    );
  });
});
