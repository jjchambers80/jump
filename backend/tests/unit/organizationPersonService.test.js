import { jest } from '@jest/globals';

const mockUserFindUnique = jest.fn();
const mockPersonFindMany = jest.fn();
const mockPersonCreate = jest.fn();
const mockPersonDeleteMany = jest.fn();
const mockTransaction = jest.fn();
const mockLoggerInfo = jest.fn();

jest.unstable_mockModule('@jump/db', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    organizationPerson: {
      findMany: mockPersonFindMany,
      create: mockPersonCreate,
      deleteMany: mockPersonDeleteMany,
    },
    $transaction: mockTransaction,
  },
}));

jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: mockLoggerInfo },
}));

const { default: organizationPersonService } = await import(
  '../../src/services/OrganizationPersonService.js'
);

const personInput = {
  firstName: 'Zoë',
  lastName: '李',
  dateOfBirth: new Date('2000-02-29T00:00:00.000Z'),
  isAccountRepresentative: false,
};
const storedPerson = {
  id: 'person-1',
  organizationId: 'org-1',
  ...personInput,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};
const safePerson = {
  id: 'person-1',
  firstName: 'Zoë',
  lastName: '李',
  isAccountRepresentative: false,
};

function assignOrganization(organizationId = 'org-1') {
  mockUserFindUnique.mockResolvedValue({ organizationId });
}

describe('OrganizationPersonService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the organization from userId and returns null when none is assigned', async () => {
    mockUserFindUnique.mockResolvedValue({ organizationId: null });

    await expect(organizationPersonService.listPeopleForUser('user-1')).resolves.toBeNull();
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { organizationId: true },
    });
    expect(mockPersonFindMany).not.toHaveBeenCalled();
  });

  it('lists only safe DTO fields scoped to the resolved organization in stable order', async () => {
    assignOrganization();
    mockPersonFindMany.mockResolvedValue([storedPerson]);

    const people = await organizationPersonService.listPeopleForUser('user-1');

    expect(mockPersonFindMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      orderBy: [{ isAccountRepresentative: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAccountRepresentative: true,
      },
    });
    expect(people).toEqual([safePerson]);
    expect(people[0]).not.toHaveProperty('dateOfBirth');
    expect(people[0]).not.toHaveProperty('organizationId');
  });

  it('creates an ordinary person directly in the resolved organization', async () => {
    assignOrganization();
    mockPersonCreate.mockResolvedValue(storedPerson);

    const person = await organizationPersonService.createPersonForUser('user-1', personInput);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockPersonCreate).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', ...personInput },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAccountRepresentative: true,
      },
    });
    expect(person).toEqual(safePerson);
  });

  it('atomically replaces the representative only within the resolved organization', async () => {
    assignOrganization();
    const representativeInput = { ...personInput, isAccountRepresentative: true };
    const representative = { ...storedPerson, isAccountRepresentative: true };
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txCreate = jest.fn().mockResolvedValue(representative);
    mockTransaction.mockImplementation((callback) =>
      callback({ organizationPerson: { updateMany: txUpdateMany, create: txCreate } })
    );

    const person = await organizationPersonService.createPersonForUser(
      'user-1',
      representativeInput
    );

    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', isAccountRepresentative: true },
      data: { isAccountRepresentative: false },
    });
    expect(txCreate).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', ...representativeInput },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAccountRepresentative: true,
      },
    });
    expect(person).toEqual({ ...safePerson, isAccountRepresentative: true });
  });

  it('translates a concurrent representative uniqueness conflict to a stable 409', async () => {
    assignOrganization();
    mockTransaction.mockRejectedValue(Object.assign(new Error('database details'), { code: 'P2002' }));

    await expect(
      organizationPersonService.createPersonForUser('user-1', {
        ...personInput,
        isAccountRepresentative: true,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Account representative changed concurrently; please retry',
    });
  });

  it('deletes by both personId and resolved organizationId without revealing other tenants', async () => {
    assignOrganization();
    mockPersonDeleteMany.mockResolvedValue({ count: 0 });

    await expect(
      organizationPersonService.deletePersonForUser('user-1', 'other-tenant-person')
    ).resolves.toBe(false);
    expect(mockPersonDeleteMany).toHaveBeenCalledWith({
      where: { id: 'other-tenant-person', organizationId: 'org-1' },
    });
  });

  it('returns null for delete when the actor has no organization', async () => {
    mockUserFindUnique.mockResolvedValue(null);

    await expect(
      organizationPersonService.deletePersonForUser('user-1', 'person-1')
    ).resolves.toBeNull();
    expect(mockPersonDeleteMany).not.toHaveBeenCalled();
  });

  it('logs only privacy-safe identifiers and action metadata after changes', async () => {
    assignOrganization();
    mockPersonCreate.mockResolvedValue(storedPerson);
    mockPersonDeleteMany.mockResolvedValue({ count: 1 });

    await organizationPersonService.createPersonForUser('user-1', personInput);
    await organizationPersonService.deletePersonForUser('user-1', 'person-1');

    expect(mockLoggerInfo).toHaveBeenNthCalledWith(1, 'Organization person changed', {
      event: 'organization_person_changed',
      actorId: 'user-1',
      organizationId: 'org-1',
      personId: 'person-1',
      action: 'created',
    });
    expect(mockLoggerInfo).toHaveBeenNthCalledWith(2, 'Organization person changed', {
      event: 'organization_person_changed',
      actorId: 'user-1',
      organizationId: 'org-1',
      personId: 'person-1',
      action: 'deleted',
    });
    const logs = JSON.stringify(mockLoggerInfo.mock.calls);
    expect(logs).not.toContain('Zoë');
    expect(logs).not.toContain('2000-02-29');
    expect(logs).not.toContain('dateOfBirth');
  });
});
