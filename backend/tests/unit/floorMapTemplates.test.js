import { jest } from '@jest/globals';
import { ConflictError, NotFoundError, ValidationError } from '../../src/middleware/errorHandler.js';
import { expoHallTemplate } from '../fixtures/floorMapTemplates.js';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));
jest.unstable_mockModule('../../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service } = await import('../../src/services/FloorMapTemplateService.js');

const templateRow = {
  id: 'tpl_1',
  organizationId: 'org_1',
  name: 'Expo hall',
  definition: expoHallTemplate,
  sourceMapId: null,
  createdAt: new Date('2026-09-21T12:00:00.000Z'),
  updatedAt: new Date('2026-09-21T12:00:00.000Z'),
};

describe('FloorMapTemplateService definition validation', () => {
  test('normalizes representative bounds, zones, elements, booths, legend and metadata', () => {
    const value = service.validateDefinition(expoHallTemplate);

    expect(value).toMatchObject({
      version: 1,
      width: 60,
      height: 40,
      unit: 'ft',
      gridSize: 10,
      orientation: 'LANDSCAPE',
    });
    expect(value.zones).toEqual([
      { id: 'zone-exhibitors', label: 'Exhibitor Hall', x: 2, y: 5, w: 42, h: 30 },
      { id: 'zone-programming', label: 'Programming', x: 46, y: 5, w: 12, h: 30 },
    ]);
    expect(value.booths[0]).toEqual({
      label: 'A1', kind: 'BOOTH', x: 5, y: 8, w: 8, h: 6,
      rotation: 0, tierLabel: 'Standard',
    });
    expect(value.legend.tiers[1]).toEqual({
      tierLabel: 'Premium', label: 'Premium booth', swatch: 1,
    });
    expect(value.metadata.brandColor).toBe('#2563EB');
  });

  test.each([
    [null, 'definition must be an object'],
    [{ height: 20 }, 'width must be an integer'],
    [{ width: 20, height: 20, orientation: 'DIAGONAL' }, 'orientation must be'],
    [{ width: 20, height: 20, zones: [{ id: 'z', label: 'Zone', x: 15, y: 0, w: 10, h: 5 }] }, 'zone 1: w'],
    [{ width: 20, height: 20, booths: [{ label: 'A1', x: 0, y: 0, w: 5, h: 5 }, { label: 'A1', x: 10, y: 0, w: 5, h: 5 }] }, 'Duplicate booth label'],
    [{ width: 20, height: 20, elements: [{ id: 'bad id', kind: 'stage', x: 0, y: 0, w: 5, h: 5 }] }, 'id must contain'],
    [{ width: 20, height: 20, legend: { tiers: [{ tierLabel: 'A', swatch: 6 }] } }, 'swatch must be 0-5'],
    [{ width: 20, height: 20, metadata: { vendorName: 'Not allowed' } }, 'Unknown metadata field'],
  ])('rejects malformed or event-specific data %#', (definition, message) => {
    expect(() => service.validateDefinition(definition)).toThrow(message);
  });

  test('generates stable element and zone ids for older definitions', () => {
    const value = service.validateDefinition({
      width: 20,
      height: 20,
      elements: [{ kind: 'stage', x: 1, y: 1, w: 4, h: 4 }],
      zones: [{ label: 'North', x: 0, y: 0, w: 10, h: 10 }],
    });
    expect(value.elements[0].id).toBe('element-001');
    expect(value.zones[0].id).toBe('zone-001');
  });
});

describe('FloorMapTemplateService deterministic materialisation', () => {
  test('returns stable responsive-render and export geometry', () => {
    const options = {
      name: 'Autumn Expo',
      tierBindings: { Standard: 'tier_standard', Premium: 'tier_premium' },
    };
    const first = service.materialise(expoHallTemplate, options);
    const second = service.materialise(expoHallTemplate, options);

    expect(first).toEqual(second);
    expect(first.layout.version).toBe(1);
    expect(first.layout.elements[0]).toMatchObject({ id: 'main-stage', kind: 'stage', w: 10, h: 6 });
    expect(first.layout.zones[0].label).toBe('Exhibitor Hall');
    expect(first.booths.map((booth) => [booth.label, booth.tierId])).toEqual([
      ['A1', 'tier_standard'],
      ['A2', 'tier_standard'],
      ['B1', 'tier_premium'],
      ['T1', null],
    ]);
    expect(first).not.toHaveProperty('materialisedAt');
    expect(first.booths[0]).not.toHaveProperty('status');
    expect(first.booths[0]).not.toHaveProperty('applicationId');
  });

  test('serializes byte-for-byte stably', () => {
    const options = { tierBindings: { Standard: 'tier_standard' } };
    const serialized = service.serialize(expoHallTemplate, options);
    expect(serialized).toBe(service.serialize(expoHallTemplate, options));
    expect(serialized).toContain('"zone-exhibitors"');
    expect(serialized).not.toContain('materialisedAt');
  });

  test('does not mutate the source fixture', () => {
    const before = JSON.stringify(expoHallTemplate);
    const output = service.materialise(expoHallTemplate);
    output.layout.elements[0].caption = 'Changed';
    expect(JSON.stringify(expoHallTemplate)).toBe(before);
  });
});

describe('FloorMapTemplateService snapshots', () => {
  test('strips live ids, state, assignments and vendor data', () => {
    const definition = service.snapshotDefinition({
      id: 'map_1',
      width: 30,
      height: 20,
      unit: 'ft',
      gridSize: 10,
      tiers: [{ id: 'tier_1', name: 'Standard' }],
      layout: {
        version: 1,
        zones: [{ id: 'north', label: 'North', x: 0, y: 0, w: 30, h: 10 }],
        elements: [{ id: 'stage', kind: 'stage', x: 1, y: 1, w: 4, h: 4 }],
      },
      booths: [{
        id: 'booth_db_1', label: 'A1', kind: 'BOOTH', x: 5, y: 5, w: 5, h: 5,
        rotation: 0, tierId: 'tier_1', status: 'SOLD', applicationId: 'app_1',
        holder: { businessName: 'Vendor' },
      }],
    });

    expect(definition.booths).toEqual([
      { label: 'A1', kind: 'BOOTH', x: 5, y: 5, w: 5, h: 5, rotation: 0, tierLabel: 'Standard' },
    ]);
    expect(JSON.stringify(definition)).not.toMatch(/booth_db_1|SOLD|app_1|Vendor|tier_1/);
    expect(definition.legend.tiers[0]).toEqual({ tierLabel: 'Standard', label: 'Standard', swatch: 0 });
  });
});

describe('FloorMapTemplateService persistence', () => {
  beforeEach(() => {
    mockPrisma.floorMapTemplate = {
      findMany: jest.fn().mockResolvedValue([templateRow]),
      findFirst: jest.fn(({ where }) => Promise.resolve(
        where.id === 'tpl_1' && (!where.organizationId || where.organizationId === 'org_1') ? templateRow : null
      )),
      create: jest.fn(({ data }) => Promise.resolve({ id: 'tpl_new', ...data, sourceMapId: null, createdAt: new Date(), updatedAt: new Date() })),
      update: jest.fn(({ data }) => Promise.resolve({ ...templateRow, ...data })),
      delete: jest.fn().mockResolvedValue({}),
    };
  });

  test('lists organization templates with geometry counts', async () => {
    const rows = await service.list('org_1');
    expect(rows[0]).toMatchObject({ boothCount: 4, zoneCount: 2, elementCount: 4 });
  });

  test('creates and reads a validated template', async () => {
    const created = await service.create('org_1', { name: 'Expo hall 2', definition: expoHallTemplate }, { byUserId: 'user_1' });
    expect(created.name).toBe('Expo hall 2');
    expect(mockPrisma.floorMapTemplate.create.mock.calls[0][0].data.createdById).toBe('user_1');
    await expect(service.get('tpl_1', 'org_1')).resolves.toMatchObject({ id: 'tpl_1' });
  });

  test('updates and removes only in organization scope', async () => {
    await expect(service.update('tpl_1', 'org_1', { name: 'Renamed hall' })).resolves.toMatchObject({ name: 'Renamed hall' });
    await expect(service.remove('tpl_1', 'org_1')).resolves.toBeUndefined();
    await expect(service.get('tpl_1', 'org_2')).rejects.toThrow(NotFoundError);
  });

  test('turns unique-name database failures into a conflict', async () => {
    mockPrisma.floorMapTemplate.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create('org_1', { name: 'Duplicate', definition: expoHallTemplate })).rejects.toThrow(ConflictError);
  });

  test('rejects incomplete create and update requests', async () => {
    await expect(service.create(null, { name: 'No org' })).rejects.toThrow(ValidationError);
    await expect(service.update('tpl_1', 'org_1', {})).rejects.toThrow(ValidationError);
  });
});
