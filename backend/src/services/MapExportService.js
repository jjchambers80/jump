// Map / Directory PDF Export Service (spec 014 phase 3)
// Generates print-ready vector PDF output from a FloorMap representation.
// Text stays as text; lines and shapes are vector primitives.
// Supports the public vendor directory as a supplementary page.
//
// Dependencies: pdfkit (pure JS, no native deps)

import { prisma } from '@jump/db';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import PDFDocument from 'pdfkit';

// ─── Layout constants (points) ──────────────────────────────────────────
const PAGE_SIZE = 'LETTER';
const MARGIN = 48;               // 0.67 inch
const HEADER_HEIGHT = 60;        // title + subtitle
const FOOTER_HEIGHT = 30;
const LEGEND_PADDING = 16;
const SWATCH_SIZE = 14;
const ROW_HEIGHT = 18;
const LABEL_FONT_SIZE = 6;
const BOOTH_LABEL_SIZE = 7;
const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 10;

// Six fixed swatch colours that work well in print (spec 014 palette).
const SWATCH_COLORS = [
  '#2563EB', '#7C3AED', '#059669',
  '#DC2626', '#F59E0B', '#0891B2',
];

// Element colours for vector drawing (match the builder rendering).
const ELEMENT_FILLS = {
  wall:      '#374151',
  stage:     '#1F2937',
  entrance:  '#059669',
  restroom:  '#6366F1',
  food:      '#D97706',
  info:      '#2563EB',
  firstAid:  '#DC2626',
  programming: '#7C3AED',
  aisle:     '#E5E7EB',
};

class MapExportService {
  /**
   * Generate a print-ready vector PDF for an organization's floor map.
   *
   * @param {string} organizationId — scoping org
   * @param {string} mapId — the FloorMap to export
   * @param {object} [opts]
   * @param {boolean} [opts.includeVendors=true] — append vendor directory page(s)
   * @returns {Promise<Buffer>} — the generated PDF bytes
   */
  async exportMapPdf(organizationId, mapId, { includeVendors = true } = {}) {
    const map = await prisma.floorMap.findFirst({
      where: { id: mapId, organizationId },
      include: {
        booths: { orderBy: [{ y: 'asc' }, { x: 'asc' }] },
        event: {
          select: {
            id: true, name: true, slug: true, date: true,
            venue: {
              select: {
                id: true, name: true, city: true, state: true,
                organization: { select: { id: true, name: true, brandColor: true } },
              },
            },
          },
        },
      },
    });
    if (!map) throw new NotFoundError('Floor map not found in this organization');
    if (!map.event) throw new NotFoundError('Event not found for this map');

    // ── Vendor data (booth-level) ──────────────────────────────────────
    let vendorData = [];
    if (includeVendors) {
      vendorData = await this._fetchVendorData(mapId, map.booths);
    }

    // ── Build the PDF ──────────────────────────────────────────────────
    const doc = new PDFDocument({
      size: PAGE_SIZE,
      layout: map.width >= map.height ? 'landscape' : 'portrait',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `Floor Map — ${map.name}`,
        Author: 'Jump Ticketing',
        Subject: `Event floor map for ${map.event.name}`,
        Keywords: 'floor map, venue, event, jump',
        Creator: 'Jump MapExportService',
      },
    });

    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const lm = MARGIN, rm = pageWidth - MARGIN;
    const tm = MARGIN, bm = pageHeight - MARGIN - FOOTER_HEIGHT;
    const headerBottom = tm + HEADER_HEIGHT;
    const availWidth = rm - lm;
    const availHeight = bm - headerBottom;

    // ── Page 1: Map ──────────────────────────────────────────────────

    // Scale: fit the full map width in the available area, with legend beside or below
    const legendWidth = 120;
    const mapAvailWidth = availWidth - (availWidth > 400 ? legendWidth : 0);
    const ptsPerUnit = Math.min(
      mapAvailWidth / map.width,
      availHeight / map.height,
    );
    const mapDrawW = map.width * ptsPerUnit;
    const mapDrawH = map.height * ptsPerUnit;
    const mapOriginX = lm;
    const mapOriginY = headerBottom;

    // ── Header ──────────────────────────────────────────────────────
    this._drawHeader(doc, lm, tm, availWidth, map);

    // ── Map grid outline ────────────────────────────────────────────
    doc.rect(mapOriginX, mapOriginY, mapDrawW, mapDrawH)
      .lineWidth(1).stroke('#333');

    // ── Draw layout elements ────────────────────────────────────────
    this._drawElements(doc, map, ptsPerUnit, mapOriginX, mapOriginY);

    // ── Draw booth boundaries ───────────────────────────────────────
    this._drawBooths(doc, map, ptsPerUnit, mapOriginX, mapOriginY);

    // ── Legend ──────────────────────────────────────────────────────
    this._drawLegend(doc, mapOriginX + mapDrawW + 12, headerBottom, map);

    // ── Footer ──────────────────────────────────────────────────────
    this._drawFooter(doc, lm, bm + 8, rm, map);

    // ── Vendor directory pages ──────────────────────────────────────
    if (includeVendors && vendorData.length > 0) {
      this._drawVendorPages(doc, lm, rm, tm, map, vendorData);
    }

    // Finalise
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.end();
    });
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  async _fetchVendorData(mapId, booths) {
    // Gather assigned application ids from SOLD / RESERVED booths
    const appIds = booths
      .filter((b) => b.applicationId && b.status !== 'AVAILABLE' && b.status !== 'BLOCKED')
      .map((b) => b.applicationId);

    if (appIds.length === 0) return [];

    const applications = await prisma.application.findMany({
      where: { id: { in: appIds } },
      select: {
        id: true,
        status: true,
        tierId: true,
        profile: { select: { businessName: true } },
        tier: { select: { id: true, name: true } },
      },
    });

    const appMap = {};
    for (const a of applications) appMap[a.id] = a;

    // Build vendor records sorted by booth label (deterministic)
    const records = [];
    for (const booth of booths) {
      if (!booth.applicationId) continue;
      const app = appMap[booth.applicationId];
      if (!app) continue;

      records.push({
        boothLabel: booth.label,
        vendorName: app.profile?.businessName || '—',
        tierName: app.tier?.name || (booth.label ? '' : '—'),
        status: booth.status,
      });
    }

    records.sort((a, b) => {
      // Sort by booth label (numeric sorting when possible)
      const aNum = parseInt(a.boothLabel.match(/\d+/)?.[0] || '0', 10);
      const bNum = parseInt(b.boothLabel.match(/\d+/)?.[0] || '0', 10);
      if (aNum !== bNum) return aNum - bNum;
      return a.boothLabel.localeCompare(b.boothLabel);
    });

    return records;
  }

  _drawHeader(doc, x, y, width, map) {
    const event = map.event;
    const orgName = event?.venue?.organization?.name || '';
    const brandColor = event?.venue?.organization?.brandColor || '#2563EB';

    doc.rect(x, y, width, HEADER_HEIGHT)
      .fillOpacity(0.03).fill('#000').fillOpacity(1);

    doc.font('Helvetica-Bold').fontSize(TITLE_SIZE)
      .fillColor(brandColor)
      .text(map.name || event.name, x, y + 4, { width, continued: false });

    const subtitle = [];
    if (event.date) {
      const d = new Date(event.date);
      subtitle.push(d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
    }
    if (event.venue?.name) subtitle.push(event.venue.name);
    if (event.venue?.city) subtitle.push(`${event.venue.city}, ${event.venue.state || ''}`);

    doc.font('Helvetica').fontSize(SUBTITLE_SIZE)
      .fillColor('#666')
      .text(subtitle.join(' — '), x, y + 32, { width, continued: false });
  }

  _drawElements(doc, map, scale, ox, oy) {
    const layout = map.layout || { elements: [] };
    const elements = layout.elements || [];

    for (const el of elements) {
      const fill = ELEMENT_FILLS[el.kind] || '#999';
      const ex = ox + el.x * scale;
      const ey = oy + el.y * scale;
      const ew = (el.w || 1) * scale;
      const eh = (el.h || 1) * scale;

      switch (el.kind) {
        case 'wall':
          doc.rect(ex, ey, ew, eh).fill(fill);
          break;
        case 'stage':
          doc.rect(ex, ey, ew, eh).fillOpacity(0.85).fill(fill).fillOpacity(1);
          if (el.caption) {
            doc.font('Helvetica-Bold').fontSize(7)
              .fillColor('#fff')
              .text(el.caption, ex + 2, ey + eh / 2 - 3, {
                width: ew - 4, align: 'center', lineBreak: false,
              });
          }
          break;
        case 'entrance':
          // Dashed outline with caption
          doc.rect(ex, ey, ew, eh)
            .lineWidth(1.5).dash(3, { space: 3 }).stroke('#059669');
          if (el.caption) {
            doc.font('Helvetica').fontSize(7)
              .fillColor('#059669')
              .text(el.caption, ex + 1, ey + eh / 2 - 3, {
                width: ew - 2, align: 'center', lineBreak: false,
              });
          }
          break;
        case 'label':
          if (el.text) {
            const sizes = { S: 6, M: 8, L: 10 };
            doc.font('Helvetica-Bold').fontSize(sizes[el.size] || 8)
              .fillColor('#111')
              .text(el.text, ex + 1, ey, {
                width: ew - 2, align: 'left', lineBreak: false,
              });
          }
          break;
        default:
          // All others (restroom, food, info, etc.)
          doc.rect(ex, ey, ew, eh).fillOpacity(0.2).fill(fill).fillOpacity(1);
          doc.rect(ex, ey, ew, eh).lineWidth(0.5).stroke(fill);
          if (el.caption) {
            doc.font('Helvetica').fontSize(6)
              .fillColor('#333')
              .text(el.caption, ex + 1, ey + eh / 2 - 3, {
                width: ew - 2, align: 'center', lineBreak: false,
              });
          }
          break;
      }
    }
  }

  _drawBooths(doc, map, scale, ox, oy) {
    const booths = map.booths || [];

    // Determine swatch per tier
    const tierLabels = [...new Set(booths.filter((b) => b.tierLabel || b.tierId).map((b) => b.tierLabel || b.tierId))];
    const tierSwatch = {};
    for (const [i, label] of tierLabels.entries()) {
      tierSwatch[label] = SWATCH_COLORS[i % SWATCH_COLORS.length];
    }

    for (const booth of booths) {
      const bx = ox + booth.x * scale;
      const by = oy + booth.y * scale;
      const bw = booth.w * scale;
      const bh = booth.h * scale;
      const swatch = tierSwatch[booth.tierLabel || booth.tierId] || '#d1d5db';
      const isOccupied = !['AVAILABLE', 'BLOCKED'].includes(booth.status);

      // Booth fill
      if (isOccupied) {
        doc.rect(bx, by, bw, bh).fillOpacity(0.15).fill(swatch).fillOpacity(1);
      }

      // Booth border
      doc.rect(bx, by, bw, bh)
        .lineWidth(0.75)
        .stroke(isOccupied ? swatch : '#9CA3AF');

      // Booth label
      const labelText = booth.label;
      doc.font('Helvetica-Bold').fontSize(BOOTH_LABEL_SIZE)
        .fillColor('#111')
        .text(labelText, bx + 1, by + 1, {
          width: bw - 2, align: 'center', lineBreak: false,
        });

      // Vendor name on occupied booths
      if (isOccupied && booth.applicationId) {
        // We won't have the vendor name here because Booth objects in
        // the map payload don't carry it. The vendor directory is on
        // subsequent pages instead.
      }
    }
  }

  _drawLegend(doc, lx, ly, map) {
    const definition = map.layout?.elements?.length >= 0 ? {} : {};
    const booths = map.booths || [];

    // Gather unique tier labels with swatch
    const tierLabels = [];
    const seen = new Set();
    for (const b of booths) {
      const key = b.tierId || b.tierLabel;
      if (key && !seen.has(key)) {
        seen.add(key);
        tierLabels.push({ id: key, label: b.tierLabel || key });
      }
    }

    if (tierLabels.length === 0) return;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#333')
      .text('Legend', lx, ly, { width: 110 });

    let itemY = ly + 16;
    for (let i = 0; i < tierLabels.length; i++) {
      const color = SWATCH_COLORS[i % SWATCH_COLORS.length];
      const item = tierLabels[i];
      if (itemY + SWATCH_SIZE + 4 > ly + HEADER_HEIGHT + 140) break; // overflow

      // Swatch box
      doc.rect(lx, itemY, SWATCH_SIZE, SWATCH_SIZE).fill(color);

      // Label
      doc.font('Helvetica').fontSize(7).fillColor('#333')
        .text(item.label, lx + SWATCH_SIZE + 4, itemY + 2, {
          width: 96, lineBreak: false,
        });

      itemY += SWATCH_SIZE + 6;
    }
  }

  _drawFooter(doc, x, y, rightX, map) {
    const now = new Date();
    doc.font('Helvetica').fontSize(7).fillColor('#999');
    doc.text(
      `Generated ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      x, y, { width: 200, continued: false }
    );
    doc.text(
      `${map.name} | ${map.width}×${map.height} ${map.unit}`,
      rightX - 180, y, { width: 180, align: 'right' },
    );
  }

  _drawVendorPages(doc, lm, rm, tm, map, vendors) {
    // Table layout
    const PAGE_TOP = tm + 20;
    const COLUMNS = [
      { label: 'Booth', width: 60 },
      { label: 'Vendor', width: 220 },
      { label: 'Tier', width: 120 },
      { label: 'Status', width: 80 },
    ];
    const TABLE_LEFT = lm;
    const TABLE_TOP = PAGE_TOP + 30;
    const HEADER_BG = '#2563EB';
    const ALT_ROW_BG = '#F9FAFB';

    const rowsPerPage = Math.floor((doc.page.height - MARGIN - TABLE_TOP - MARGIN) / ROW_HEIGHT) - 1;

    for (let pageStart = 0; pageStart < vendors.length; pageStart += rowsPerPage) {
      // Each vendor directory block starts on a new page (separate from the map)
      doc.addPage();

      // Page title
      const pageNum = Math.floor(pageStart / rowsPerPage) + 1;
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
        .text('Vendor Directory', lm, PAGE_TOP, { width: rm - lm });
      doc.font('Helvetica').fontSize(8).fillColor('#666')
        .text(`${map.name} — ${vendors.length} ${vendors.length === 1 ? 'vendor' : 'vendors'} listed`, lm, PAGE_TOP + 16);

      // Table header
      let tableY = TABLE_TOP;
      let colX = TABLE_LEFT;
      doc.rect(TABLE_LEFT, tableY, rm - lm, ROW_HEIGHT).fill(HEADER_BG);
      let headerX = TABLE_LEFT;
      for (const col of COLUMNS) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff')
          .text(col.label, headerX + 4, tableY + 4, { width: col.width - 8, lineBreak: false });
        headerX += col.width;
      }
      tableY += ROW_HEIGHT;

      // Table rows
      const pageRows = vendors.slice(pageStart, pageStart + rowsPerPage);
      for (const [ri, row] of pageRows.entries()) {
        const isAlt = ri % 2 === 1;
        if (isAlt) {
          doc.rect(TABLE_LEFT, tableY, rm - lm, ROW_HEIGHT).fill(ALT_ROW_BG);
        }

        const cells = [
          row.boothLabel,
          row.vendorName,
          row.tierName,
          row.status === 'SOLD' ? 'Sold' : row.status === 'RESERVED' ? 'Reserved' : row.status,
        ];

        let cellX = TABLE_LEFT;
        for (const [ci, cell] of cells.entries()) {
          doc.font('Helvetica').fontSize(8).fillColor('#333')
            .text(cell, cellX + 4, tableY + 4, {
              width: COLUMNS[ci].width - 8, lineBreak: false,
            });
          cellX += COLUMNS[ci].width;
        }
        tableY += ROW_HEIGHT;
      }

      // Page number footer
      doc.font('Helvetica').fontSize(7).fillColor('#999');
      doc.text(
        `Page ${pageNum}`,
        rm - 60, doc.page.height - MARGIN + 10,
        { width: 60, align: 'right' },
      );
    }
  }
}

export default new MapExportService();