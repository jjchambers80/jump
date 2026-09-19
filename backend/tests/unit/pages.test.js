import { jest } from '@jest/globals';
import { validateCreatePage, validateUpdatePage } from '../../src/api/validators/pageValidators.js';

const page = {
  findMany: jest.fn(),
  findFirst: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const storeFile = { findMany: jest.fn().mockResolvedValue([]) };
const storeFileReference = { deleteMany: jest.fn(), createMany: jest.fn() };
const $transaction = jest.fn().mockResolvedValue([]);

jest.unstable_mockModule('@jump/db', () => ({
  prisma: { page, storeFile, storeFileReference, $transaction },
}));

const { default: pageService } = await import('../../src/services/PageService.js');

function validate(body) {
  const next = jest.fn();
  validateCreatePage({ body }, {}, next);
  return next.mock.calls[0]?.[0];
}

function validateUpdate(body) {
  const next = jest.fn();
  validateUpdatePage({ body }, {}, next);
  return next.mock.calls[0]?.[0];
}

describe('Online Store pages', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists only the requested organization in stable newest-first order', async () => {
    page.findMany.mockResolvedValue([{ id: 'page-1' }]);

    await expect(pageService.list('org-1')).resolves.toEqual([{ id: 'page-1' }]);
    expect(page.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('creates a trimmed page, derives the slug from the title and defaults visibility to true', async () => {
    page.findFirst.mockResolvedValue(null);
    page.create.mockResolvedValue({ id: 'page-1' });

    await pageService.create('org-1', { title: '  About Us!  ', content: '  <p>Story</p>  ' });

    expect(page.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        title: 'About Us!',
        slug: 'about-us',
        content: '<p>Story</p>',
        isVisible: true,
        seoTitle: null,
        seoDescription: null,
      },
    });
  });

  it('suffixes the slug when it clashes within the organization', async () => {
    page.findFirst.mockResolvedValueOnce({ id: 'other' }).mockResolvedValueOnce(null);
    page.create.mockResolvedValue({ id: 'page-2' });

    await pageService.create('org-1', { title: 'About', content: 'x', slug: 'About' });

    expect(page.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-1', slug: 'about' }),
      })
    );
    expect(page.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ slug: 'about-2' }) })
    );
  });

  it('rejects a slug with no letters or digits', async () => {
    await expect(pageService.create('org-1', { title: '!!!', content: 'x' })).rejects.toMatchObject(
      { statusCode: 400 }
    );
  });

  it('gets a page only within the organization', async () => {
    page.findFirst.mockResolvedValue(null);
    await expect(pageService.get('org-1', 'page-9')).rejects.toMatchObject({ statusCode: 404 });
    expect(page.findFirst).toHaveBeenCalledWith({
      where: { id: 'page-9', organizationId: 'org-1' },
    });
  });

  it('updates only the fields given and stores blank SEO fields as null', async () => {
    page.findFirst.mockResolvedValueOnce({ id: 'page-1', title: 'About', slug: 'about' });
    page.update.mockResolvedValue({ id: 'page-1' });

    await pageService.update('org-1', 'page-1', {
      seoTitle: '  ',
      seoDescription: ' Learn more ',
      isVisible: true,
    });

    expect(page.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { seoTitle: null, seoDescription: 'Learn more', isVisible: true },
    });
  });

  it('re-derives the slug from the title when the handle is cleared', async () => {
    page.findFirst
      .mockResolvedValueOnce({ id: 'page-1', title: 'About', slug: 'about' })
      .mockResolvedValueOnce(null);
    page.update.mockResolvedValue({ id: 'page-1' });

    await pageService.update('org-1', 'page-1', { title: 'Our Story', slug: '' });

    expect(page.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ slug: 'our-story', NOT: { id: 'page-1' } }),
      })
    );
    expect(page.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: { title: 'Our Story', slug: 'our-story' },
    });
  });

  it('accepts valid content and an explicit visibility setting', () => {
    expect(validate({ title: 'About', content: '<p>Story</p>', isVisible: false })).toBeUndefined();
  });

  it.each([
    [{ content: 'Body' }, 'title'],
    [{ title: 'Title' }, 'content'],
    [{ title: ' ', content: 'Body' }, 'title'],
    [{ title: 'Title', content: ' ', isVisible: true }, 'content'],
    [{ title: 'Title', content: 'Body', isVisible: 'false' }, 'isVisible'],
  ])('rejects invalid input %#', (body, field) => {
    const error = validate(body);

    expect(error?.statusCode).toBe(400);
    expect(error?.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
  });

  it.each([
    [{ title: 'T', content: 'B', seoTitle: 'x'.repeat(71) }, 'seoTitle'],
    [{ title: 'T', content: 'B', seoDescription: 'x'.repeat(161) }, 'seoDescription'],
    [{ title: 'T', content: 'B', slug: 'x'.repeat(61) }, 'slug'],
    [{ title: 'T', content: 'B', slug: 5 }, 'slug'],
  ])('rejects search engine listing input over its limit %#', (body, field) => {
    const error = validate(body);
    expect(error?.statusCode).toBe(400);
    expect(error?.details).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
  });

  it('accepts search engine listing fields at their limits and null to clear', () => {
    expect(
      validate({
        title: 'T',
        content: 'B',
        seoTitle: 'x'.repeat(70),
        seoDescription: 'y'.repeat(160),
        slug: 'about-us',
      })
    ).toBeUndefined();
    expect(
      validate({ title: 'T', content: 'B', seoTitle: null, seoDescription: null, slug: null })
    ).toBeUndefined();
  });

  it('update validation allows partial bodies but still rejects invalid present fields', () => {
    expect(validateUpdate({ isVisible: false })).toBeUndefined();
    expect(validateUpdate({ seoTitle: 'Short' })).toBeUndefined();
    expect(validateUpdate({ title: ' ' })?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'title' })])
    );
    expect(validateUpdate({ content: '' })?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'content' })])
    );
  });
});
