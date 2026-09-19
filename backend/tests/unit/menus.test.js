// Content › Menus (spec 027): tree building, href resolution, tree validation.

import { ValidationError } from '../../src/middleware/errorHandler.js';
import menuService, { buildTree, hrefFor, MENU_MAX_DEPTH } from '../../src/services/MenuService.js';

describe('buildTree', () => {
  it('nests by parentId and sorts by position', () => {
    const rows = [
      { id: 'b', parentId: null, position: 1 },
      { id: 'a', parentId: null, position: 0 },
      { id: 'a2', parentId: 'a', position: 1 },
      { id: 'a1', parentId: 'a', position: 0 },
    ];
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(tree[1].children).toEqual([]);
  });
});

describe('hrefFor', () => {
  it('maps every link type to a platform path', () => {
    const org = 'org_1';
    expect(hrefFor(org, { linkType: 'HOME' })).toBe('/organizations/org_1');
    expect(hrefFor(org, { linkType: 'EVENTS' })).toBe('/organizations/org_1#events');
    expect(hrefFor(org, { linkType: 'EVENT', targetId: 'e1' })).toBe('/events/e1');
    expect(hrefFor(org, { linkType: 'VENUE', targetId: 'v1' })).toBe('/venues/v1');
    expect(hrefFor(org, { linkType: 'PAGE' }, { slug: 'faq' })).toBe(
      '/organizations/org_1/pages/faq'
    );
    expect(hrefFor(org, { linkType: 'BLOG' }, { handle: 'news' })).toBe(
      '/organizations/org_1/blogs/news'
    );
    expect(
      hrefFor(org, { linkType: 'BLOG_POST' }, { handle: 'recap', blog: { handle: 'news' } })
    ).toBe('/organizations/org_1/blogs/news/recap');
    expect(hrefFor(org, { linkType: 'ACCOUNT' })).toBe('/organizations/org_1/account');
    expect(hrefFor(org, { linkType: 'EXTERNAL', url: 'https://x.test' })).toBe('https://x.test');
    expect(hrefFor(org, { linkType: 'PAGE' }, null)).toBeNull();
  });
});

describe('_flatten (tree validation)', () => {
  const item = (label, extra = {}) => ({ label, linkType: 'HOME', ...extra });

  it('flattens parents before children with positions and keys', () => {
    const flat = menuService._flatten([
      item('Home'),
      item('Shop', {
        children: [item('All', { linkType: 'EXTERNAL', url: 'https://x.test', newTab: true })],
      }),
    ]);
    expect(flat.map((r) => [r.label, r.parentKey, r.position])).toEqual([
      ['Home', null, 0],
      ['Shop', null, 1],
      ['All', 'root/1', 0],
    ]);
    expect(flat[2]).toMatchObject({ url: 'https://x.test', newTab: true, targetId: null });
  });

  it('rejects depth beyond the limit, bad labels, bad urls and missing targets', () => {
    let deep = item('L');
    for (let i = 0; i < MENU_MAX_DEPTH; i += 1) deep = item(`L${i}`, { children: [deep] });
    expect(() => menuService._flatten([deep])).toThrow(ValidationError);
    expect(() => menuService._flatten([item('')])).toThrow(ValidationError);
    expect(() => menuService._flatten([item('x'.repeat(61))])).toThrow(ValidationError);
    expect(() =>
      menuService._flatten([item('Ext', { linkType: 'EXTERNAL', url: 'javascript:alert(1)' })])
    ).toThrow(ValidationError);
    expect(() => menuService._flatten([item('Page', { linkType: 'PAGE' })])).toThrow(
      ValidationError
    );
    expect(() => menuService._flatten([item('Nope', { linkType: 'SEARCH' })])).toThrow(
      ValidationError
    );
    expect(() => menuService._flatten('nope')).toThrow(ValidationError);
  });

  it('accepts exactly the maximum depth', () => {
    const three = item('1', { children: [item('2', { children: [item('3')] })] });
    expect(menuService._flatten([three])).toHaveLength(3);
  });
});
