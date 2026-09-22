// Contract coverage for the Contact record added by spec 032 phase 1.

const { prisma } = await import('@jump/db');

const TAG = 'contact-schema-ct';

describe('Contact phone and tags schema (spec 032 phase 1)', () => {
  let organization;

  beforeAll(async () => {
    await prisma.organization.deleteMany({ where: { name: `${TAG} Org` } }).catch(() => {});
    organization = await prisma.organization.create({ data: { name: `${TAG} Org` } });
  });

  afterAll(async () => {
    if (!organization) return;
    await prisma.contact.deleteMany({ where: { organizationId: organization.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: organization.id } }).catch(() => {});
  });

  it('defaults tags to an empty array and phone to null', async () => {
    const contact = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        email: `default@${TAG}.test`,
        firstName: 'Default',
        lastName: 'Contact',
      },
    });

    expect(contact).toMatchObject({ phone: null, tags: [] });
  });

  it('stores an optional phone number and contact tags', async () => {
    const contact = await prisma.contact.create({
      data: {
        organizationId: organization.id,
        email: `values@${TAG}.test`,
        firstName: 'Tagged',
        lastName: 'Contact',
        phone: '+19195550123',
        tags: ['VIP', 'Press'],
      },
    });

    expect(contact).toMatchObject({ phone: '+19195550123', tags: ['VIP', 'Press'] });
  });

  it('has a GIN index for tag containment queries', async () => {
    const indexes = await prisma.$queryRaw`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'Contact'
        AND indexname = 'Contact_tags_idx'
    `;

    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toMatch(/USING gin \("?tags"?\)/i);
  });
});
