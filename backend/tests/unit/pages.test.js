import { jest } from '@jest/globals';
import { validateCreatePage } from '../../src/api/validators/pageValidators.js';

const page = {
  findMany: jest.fn(),
  create: jest.fn(),
};

jest.unstable_mockModule('@jump/db', () => ({ prisma: { page } }));

const { default: pageService } = await import('../../src/services/PageService.js');

function validate(body) {
  const next = jest.fn();
  validateCreatePage({ body }, {}, next);
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

  it('creates a trimmed page and defaults visibility to true', async () => {
    page.create.mockResolvedValue({ id: 'page-1' });

    await pageService.create('org-1', { title: '  About  ', content: '  <p>Story</p>  ' });

    expect(page.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        title: 'About',
        content: '<p>Story</p>',
        isVisible: true,
      },
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
});
