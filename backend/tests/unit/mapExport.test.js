// Unit tests for MapExportService (spec 014 phase 3)
// Tests: export flow, validation, PDF structure, vendor directory.
// Uses mocked pdfkit and prisma — the PDF output is verified in contract tests.

import { jest } from '@jest/globals';
import { NotFoundError } from '../../src/middleware/errorHandler.js';
import { expoHallTemplate } from '../fixtures/floorMapTemplates.js';

const mockPrisma = {};
jest.unstable_mockModule('@jump/db', () => ({ prisma: mockPrisma }));

// Mock pdfkit — collect draw calls so we can verify vector primitives
const textCalls = [];
const rectCalls = [];
const fillCalls = [];
const drawLog = [];

jest.unstable_mockModule('pdfkit', () => ({
  default: class MockPDFDocument {
    constructor() {
      this.page = { width: 792, height: 612 };
      this._endCb = null;
      this._dataCb = null;
    }
    on(event, cb) {
      if (event === 'data') this._dataCb = cb;
      if (event === 'end') this._endCb = cb;
      return this;
    }
    end() {
      const dataCb = this._dataCb;
      const endCb = this._endCb;
      setImmediate(() => {
        if (dataCb) dataCb(Buffer.from('%PDF-1.4 mock content'));
        if (endCb) endCb();
      });
    }
    font() { return this; }
    fontSize() { return this; }
    fillColor(c) { return this; }
    fillOpacity() { return this; }
    lineWidth() { return this; }
    dash() { return this; }
    fill() { fillCalls.push('fill'); return this; }
    stroke() { return this; }
    rect(x, y, w, h) { rectCalls.push({ x, y, w, h }); return this; }
    text(t) { textCalls.push(t); return this; }
    addPage() { drawLog.push('addPage'); return this; }
  },
}));

const { default: service } = await import('../../src/services/MapExportService.js');

describe('MapExportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    textCalls.length = 0;
    rectCalls.length = 0;
    fillCalls.length = 0;
    drawLog.length = 0;
  });

  const orgId = 'org_1';
  const mapId = 'map_1';

  const baseMap = {
    id: mapId,
    organizationId: orgId,
    name: 'Expo Hall Map',
    width: 60,
    height: 40,
    unit: 'ft',
    gridSize: 10,
    status: 'PUBLISHED',
    layout: {
      version: 1,
      elements: expoHallTemplate.elements,
    },
    booths: expoHallTemplate.booths.map((b, i) => ({
      id: `booth_${i + 1}`,
      mapId,
      label: b.label,
      kind: b.kind,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      rotation: b.rotation,
      tierLabel: b.tierLabel,
      tierId: b.tierLabel === 'Standard' ? 'tier_std' : null,
      status: i < 2 ? 'SOLD' : 'AVAILABLE',
      applicationId: i < 2 ? `app_${i + 1}` : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    event: {
      id: 'evt_1',
      name: 'Tech Expo 2026',
      slug: 'tech-expo-2026',
      date: new Date('2026-12-15T09:00:00.000Z'),
      venue: {
        id: 'ven_1',
        name: 'Convention Center',
        city: 'New York',
        state: 'NY',
        organization: { id: orgId, name: 'Event Org', brandColor: '#2563EB' },
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const defaultAppMock = [
    { id: 'app_1', status: 'APPROVED', tierId: 'tier_std', profile: { businessName: 'Vendor A' }, tier: { id: 'tier_std', name: 'Standard' } },
    { id: 'app_2', status: 'APPROVED', tierId: 'tier_std', profile: { businessName: 'Vendor B' }, tier: { id: 'tier_std', name: 'Standard' } },
  ];

  beforeEach(() => {
    mockPrisma.application = { findMany: jest.fn().mockResolvedValue(defaultAppMock) };
  });

  describe('exportMapPdf', () => {
    test('throws NotFoundError when map not found in org', async () => {
      mockPrisma.floorMap = { findFirst: jest.fn().mockResolvedValue(null) };
      await expect(service.exportMapPdf(orgId, mapId)).rejects.toThrow(NotFoundError);
    });

    test('throws NotFoundError when event is missing', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({ ...baseMap, event: null }),
      };
      await expect(service.exportMapPdf(orgId, mapId)).rejects.toThrow(NotFoundError);
    });

    test('generates a PDF buffer for a valid map without vendors', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({
          ...baseMap,
          booths: baseMap.booths.map((b) => ({ ...b, applicationId: null, status: 'AVAILABLE' })),
        }),
      };

      const result = await service.exportMapPdf(orgId, mapId, { includeVendors: false });
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.toString('utf8')).toContain('%PDF-1.4');
    });

    test('draws vector primitives (rect, fill, text) — not raster images', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({
          ...baseMap,
          booths: baseMap.booths.map((b) => ({ ...b, applicationId: null, status: 'AVAILABLE' })),
        }),
      };

      await service.exportMapPdf(orgId, mapId, { includeVendors: false });

      // Verify vector primitives
      expect(rectCalls.length).toBeGreaterThan(0);
      expect(fillCalls.length).toBeGreaterThan(0);

      // Header draws the map name (bold, large)
      expect(textCalls.some((t) => t.includes('Expo Hall Map'))).toBe(true);
      // Subtitle draws venue info
      expect(textCalls.some((t) => t.includes('December'))).toBe(true);
      expect(textCalls.some((t) => t.includes('Convention Center'))).toBe(true);
      // Booth labels as vector text
      expect(textCalls.some((t) => t.includes('A1'))).toBe(true);
      // Footer
      expect(textCalls.some((t) => t.includes('Generated'))).toBe(true);
    });

    test('supports map with SOLD booths and vendor directory', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue(baseMap),
      };

      const result = await service.exportMapPdf(orgId, mapId, { includeVendors: true });
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // Should have fetched vendor data
      expect(mockPrisma.application.findMany).toHaveBeenCalled();
    });
  });

  describe('vendor directory pages', () => {
    test('adds vendor pages when booths are assigned', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue(baseMap),
      };

      await service.exportMapPdf(orgId, mapId, { includeVendors: true });
      // Vendor directory should cause a new page
      expect(drawLog.includes('addPage')).toBe(true);
      // Vendor directory text should appear
      expect(textCalls.some((t) => t.includes('Vendor Directory'))).toBe(true);
      expect(textCalls.some((t) => t.includes('Vendor A'))).toBe(true);
      expect(textCalls.some((t) => t.includes('Vendor B'))).toBe(true);
    });

    test('skips vendor directory when includeVendors=false', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue(baseMap),
      };

      await service.exportMapPdf(orgId, mapId, { includeVendors: false });
      expect(drawLog.includes('addPage')).toBe(false);
      expect(textCalls.some((t) => t.includes('Vendor Directory'))).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles map with all AVAILABLE booths (no vendors)', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({
          ...baseMap,
          booths: baseMap.booths.map((b) => ({ ...b, applicationId: null, status: 'AVAILABLE' })),
        }),
      };

      const result = await service.exportMapPdf(orgId, mapId, { includeVendors: true });
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    test('handles map with BLOCKED booths only', async () => {
      mockPrisma.floorMap = {
        findFirst: jest.fn().mockResolvedValue({
          ...baseMap,
          booths: baseMap.booths.map((b) => ({ ...b, applicationId: null, status: 'BLOCKED' })),
        }),
      };

      const result = await service.exportMapPdf(orgId, mapId, { includeVendors: true });
      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });
});