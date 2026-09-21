// Floor Map Template Service (spec 014 phase 3)
// Reusable, organization-scoped vector layout snapshots. Templates contain
// geometry and presentation metadata only; live booth state and vendor data
// are deliberately excluded.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';
import {
  BOOTH_KINDS,
  DEFAULT_GRID_SIZE,
  ELEMENT_KINDS,
  LABEL_SIZES,
  MAX_BOOTH_SIZE,
  MAX_BOOTHS,
  MAX_ELEMENTS,
  MAX_MAP_HEIGHT,
  MAX_MAP_WIDTH,
  MIN_BOOTH_SIZE,
  ROTATIONS,
  SWATCH_COUNT,
  UNITS,
} from '../config/maps.js';
import logger from '../utils/logger.js';

const DEFAULT_DEFINITION = Object.freeze({
  version: 1,
  width: 50,
  height: 40,
  unit: 'ft',
  gridSize: DEFAULT_GRID_SIZE,
  orientation: 'AUTO',
  elements: [],
  zones: [],
  booths: [],
  legend: null,
  metadata: null,
});

const DEFINITION_KEYS = new Set([
  'version', 'width', 'height', 'unit', 'gridSize', 'orientation',
  'elements', 'zones', 'booths', 'legend', 'metadata',
]);
const ELEMENT_KEYS = new Set(['id', 'kind', 'x', 'y', 'w', 'h', 'caption', 'text', 'size', 'orientation']);
const ZONE_KEYS = new Set(['id', 'label', 'x', 'y', 'w', 'h']);
const BOOTH_KEYS = new Set(['label', 'kind', 'x', 'y', 'w', 'h', 'rotation', 'tierLabel']);
const LEGEND_KEYS = new Set(['title', 'orientation', 'tiers']);
const LEGEND_TIER_KEYS = new Set(['tierLabel', 'label', 'swatch']);
const METADATA_KEYS = new Set(['eventTitle', 'subtitle', 'brandColor', 'themeMode']);
const ORIENTATIONS = new Set(['AUTO', 'LANDSCAPE', 'PORTRAIT']);
const LEGEND_ORIENTATIONS = new Set(['auto', 'horizontal', 'vertical']);

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message);
  }
}

function assertKnownKeys(value, allowed, prefix) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new ValidationError(`Unknown ${prefix} field: ${key}`);
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class FloorMapTemplateService {
  async list(organizationId) {
    const rows = await prisma.floorMapTemplate.findMany({
      where: organizationId ? { organizationId } : {},
      include: { organization: { select: { id: true, name: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((template) => this._serializeSummary(template, !organizationId));
  }

  async get(templateId, organizationId) {
    return this._serialize(await this.requireInScope(templateId, organizationId));
  }

  async create(organizationId, { name, definition }, { byUserId = null } = {}) {
    if (!organizationId) throw new ValidationError('organizationId is required');
    const created = await this._write(() => prisma.floorMapTemplate.create({
      data: {
        organizationId,
        name: this._validateName(name),
        definition: this.validateDefinition(definition ?? DEFAULT_DEFINITION),
        createdById: byUserId,
      },
    }));
    logger.info('Floor map template created', {
      event: 'floor_map_template_created', organizationId, templateId: created.id,
    });
    return this._serialize(created);
  }

  async update(templateId, organizationId, { name, definition }) {
    const existing = await this.requireInScope(templateId, organizationId);
    const data = {};
    if (name !== undefined) data.name = this._validateName(name);
    if (definition !== undefined) data.definition = this.validateDefinition(definition);
    if (Object.keys(data).length === 0) throw new ValidationError('Nothing to update');
    return this._serialize(await this._write(() =>
      prisma.floorMapTemplate.update({ where: { id: existing.id }, data })
    ));
  }

  async remove(templateId, organizationId) {
    const existing = await this.requireInScope(templateId, organizationId);
    await prisma.floorMapTemplate.delete({ where: { id: existing.id } });
    logger.info('Floor map template deleted', {
      event: 'floor_map_template_deleted', templateId: existing.id,
    });
  }

  async saveFrom(mapPayload, organizationId, { name, replaceTemplateId = null }, { byUserId = null } = {}) {
    if (!organizationId) throw new ValidationError('organizationId is required');
    const definition = this.validateDefinition(this.snapshotDefinition(mapPayload));
    if (replaceTemplateId) {
      const target = await this.requireInScope(replaceTemplateId, organizationId);
      const data = { definition, sourceMapId: mapPayload.id ?? target.sourceMapId };
      if (name !== undefined) data.name = this._validateName(name);
      const updated = await this._write(() =>
        prisma.floorMapTemplate.update({ where: { id: target.id }, data })
      );
      return this._serialize(updated);
    }

    const created = await this._write(() => prisma.floorMapTemplate.create({
      data: {
        organizationId,
        name: this._validateName(name),
        definition,
        sourceMapId: mapPayload.id ?? null,
        createdById: byUserId,
      },
    }));
    logger.info('Floor map template saved from map', {
      event: 'floor_map_template_saved', templateId: created.id, sourceMapId: mapPayload.id ?? null,
    });
    return this._serialize(created);
  }

  async requireInScope(templateId, organizationId) {
    const template = await prisma.floorMapTemplate.findFirst({
      where: { id: String(templateId), ...(organizationId ? { organizationId } : {}) },
    });
    if (!template) throw new NotFoundError('Floor map template not found');
    return template;
  }

  /**
   * Canonical deterministic representation consumed by FloorMap creation,
   * responsive SVG rendering, and vector export. Tier bindings are supplied by
   * the destination event; template snapshots never persist event tier ids.
   */
  materialise(definition, { name, tierBindings = {} } = {}) {
    const value = this.validateDefinition(definition);
    if (!tierBindings || typeof tierBindings !== 'object' || Array.isArray(tierBindings)) {
      throw new ValidationError('tierBindings must be an object');
    }
    for (const [label, tierId] of Object.entries(tierBindings)) {
      if (!label || typeof tierId !== 'string' || !tierId) {
        throw new ValidationError('tierBindings values must be non-empty tier ids');
      }
    }

    return {
      schemaVersion: value.version,
      ...(name ? { name: String(name) } : {}),
      width: value.width,
      height: value.height,
      unit: value.unit,
      gridSize: value.gridSize,
      orientation: value.orientation,
      layout: {
        version: value.version,
        elements: clone(value.elements),
        zones: clone(value.zones),
      },
      booths: value.booths.map((booth) => ({
        label: booth.label,
        kind: booth.kind,
        x: booth.x,
        y: booth.y,
        w: booth.w,
        h: booth.h,
        rotation: booth.rotation,
        tierLabel: booth.tierLabel,
        tierId: booth.tierLabel ? (tierBindings[booth.tierLabel] ?? null) : null,
      })),
      legend: clone(value.legend),
      metadata: clone(value.metadata),
    };
  }

  /** Stable JSON for downstream hashing and snapshot tests. */
  serialize(definition, options = {}) {
    return JSON.stringify(this.materialise(definition, options));
  }

  validateDefinition(definition) {
    assertObject(definition, 'definition must be an object');
    assertKnownKeys(definition, DEFINITION_KEYS, 'definition');

    const version = definition.version ?? 1;
    if (version !== 1) throw new ValidationError('version must be 1');
    const width = this._bound('width', definition.width, MAX_MAP_WIDTH);
    const height = this._bound('height', definition.height, MAX_MAP_HEIGHT);
    const unit = definition.unit ?? 'ft';
    if (!UNITS.has(unit)) throw new ValidationError('unit must be "ft" or "m"');
    const gridSize = definition.gridSize ?? DEFAULT_GRID_SIZE;
    if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 100) {
      throw new ValidationError('gridSize must be an integer between 1 and 100');
    }
    const orientation = definition.orientation ?? 'AUTO';
    if (!ORIENTATIONS.has(orientation)) {
      throw new ValidationError('orientation must be AUTO, LANDSCAPE, or PORTRAIT');
    }

    const elements = this._array(definition.elements, 'elements', MAX_ELEMENTS)
      .map((element, index) => this._element(element, index, width, height));
    this._uniqueIds(elements, 'element');

    const zones = this._array(definition.zones, 'zones', MAX_ELEMENTS)
      .map((zone, index) => this._zone(zone, index, width, height));
    this._uniqueIds(zones, 'zone');

    const booths = this._array(definition.booths, 'booths', MAX_BOOTHS)
      .map((booth, index) => this._booth(booth, index, width, height));
    const boothLabels = new Set();
    for (const booth of booths) {
      if (boothLabels.has(booth.label)) throw new ValidationError(`Duplicate booth label: ${booth.label}`);
      boothLabels.add(booth.label);
    }

    return {
      version,
      width,
      height,
      unit,
      gridSize,
      orientation,
      elements,
      zones,
      booths,
      legend: this._legend(definition.legend),
      metadata: this._metadata(definition.metadata),
    };
  }

  snapshotDefinition(mapPayload) {
    assertObject(mapPayload, 'mapPayload is required');
    const tierNames = new Map((mapPayload.tiers || []).map((tier) => [tier.id, tier.name]));
    const elements = mapPayload.layout?.elements || mapPayload.elements || [];
    const zones = mapPayload.layout?.zones || mapPayload.zones || [];
    const tierLabels = [];
    for (const tier of mapPayload.tiers || []) {
      if (!tierLabels.includes(tier.name)) tierLabels.push(tier.name);
    }

    return {
      version: 1,
      width: mapPayload.width,
      height: mapPayload.height,
      unit: mapPayload.unit ?? 'ft',
      gridSize: mapPayload.gridSize ?? DEFAULT_GRID_SIZE,
      orientation: mapPayload.orientation ?? 'AUTO',
      elements: elements.map((element, index) => ({
        id: element.id || `element-${String(index + 1).padStart(3, '0')}`,
        kind: element.kind,
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        ...(element.caption != null ? { caption: element.caption } : {}),
        ...(element.text != null ? { text: element.text } : {}),
        ...(element.size != null ? { size: element.size } : {}),
        ...(element.orientation != null ? { orientation: element.orientation } : {}),
      })),
      zones: zones.map((zone, index) => ({
        id: zone.id || `zone-${String(index + 1).padStart(3, '0')}`,
        label: zone.label,
        x: zone.x,
        y: zone.y,
        w: zone.w,
        h: zone.h,
      })),
      booths: (mapPayload.booths || []).map((booth) => ({
        label: booth.label,
        kind: booth.kind ?? 'BOOTH',
        x: booth.x,
        y: booth.y,
        w: booth.w,
        h: booth.h,
        rotation: booth.rotation ?? 0,
        tierLabel: booth.tierLabel ?? tierNames.get(booth.tierId) ?? null,
      })),
      legend: mapPayload.legend ?? (tierLabels.length ? {
        orientation: 'auto',
        tiers: tierLabels.map((tierLabel, swatch) => ({ tierLabel, label: tierLabel, swatch: swatch % SWATCH_COUNT })),
      } : null),
      metadata: mapPayload.metadata ?? null,
    };
  }

  _array(value, name, max) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ValidationError(`${name} must be an array`);
    if (value.length > max) throw new ValidationError(`at most ${max} ${name}`);
    return value;
  }

  _bound(name, value, max) {
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new ValidationError(`${name} must be an integer between 1 and ${max}`);
    }
    return value;
  }

  _coordinate(value, prefix, axis, max) {
    if (!Number.isInteger(value) || value < 0 || value >= max) {
      throw new ValidationError(`${prefix}: ${axis} must be an integer between 0 and ${max - 1}`);
    }
    return value;
  }

  _rectangle(value, index, width, height, kind) {
    const prefix = `${kind} ${index + 1}`;
    const x = this._coordinate(value.x, prefix, 'x', width);
    const y = this._coordinate(value.y, prefix, 'y', height);
    if (!Number.isInteger(value.w) || value.w < 1 || x + value.w > width) {
      throw new ValidationError(`${prefix}: w must be a positive integer fitting within the map`);
    }
    if (!Number.isInteger(value.h) || value.h < 1 || y + value.h > height) {
      throw new ValidationError(`${prefix}: h must be a positive integer fitting within the map`);
    }
    return { x, y, w: value.w, h: value.h };
  }

  _element(element, index, width, height) {
    assertObject(element, `element ${index + 1} must be an object`);
    assertKnownKeys(element, ELEMENT_KEYS, 'element');
    if (!ELEMENT_KINDS.has(element.kind)) throw new ValidationError(`element ${index + 1}: unknown kind "${element.kind}"`);
    const rect = this._rectangle(element, index, width, height, 'element');
    const result = {
      id: this._id(element.id, 'element', index),
      kind: element.kind,
      ...rect,
    };
    if (element.caption !== undefined) result.caption = this._text(element.caption, `element ${index + 1}: caption`, 200, true);
    if (element.kind === 'label') {
      result.text = this._text(element.text ?? '', `element ${index + 1}: text`, 200, false);
      result.size = element.size ?? 'M';
      if (!LABEL_SIZES.has(result.size)) throw new ValidationError(`element ${index + 1}: size must be S, M or L`);
    }
    if (element.orientation !== undefined) {
      if (!['h', 'v'].includes(element.orientation)) throw new ValidationError(`element ${index + 1}: orientation must be h or v`);
      result.orientation = element.orientation;
    }
    return result;
  }

  _zone(zone, index, width, height) {
    assertObject(zone, `zone ${index + 1} must be an object`);
    assertKnownKeys(zone, ZONE_KEYS, 'zone');
    return {
      id: this._id(zone.id, 'zone', index),
      label: this._text(zone.label, `zone ${index + 1}: label`, 80, false, true),
      ...this._rectangle(zone, index, width, height, 'zone'),
    };
  }

  _booth(booth, index, width, height) {
    assertObject(booth, `booth ${index + 1} must be an object`);
    assertKnownKeys(booth, BOOTH_KEYS, 'booth');
    const label = this._text(booth.label, `booth ${index + 1}: label`, 20, false, true);
    const kind = booth.kind ?? 'BOOTH';
    if (!BOOTH_KINDS.has(kind)) throw new ValidationError(`booth ${index + 1}: kind must be BOOTH or TABLE`);
    const rect = this._rectangle(booth, index, width, height, 'booth');
    if (rect.w < MIN_BOOTH_SIZE || rect.w > MAX_BOOTH_SIZE || rect.h < MIN_BOOTH_SIZE || rect.h > MAX_BOOTH_SIZE) {
      throw new ValidationError(`booth ${index + 1}: dimensions must be ${MIN_BOOTH_SIZE}-${MAX_BOOTH_SIZE}`);
    }
    const rotation = booth.rotation ?? 0;
    if (!ROTATIONS.has(rotation)) throw new ValidationError(`booth ${index + 1}: rotation must be 0 or 90`);
    return {
      label,
      kind,
      ...rect,
      rotation,
      tierLabel: booth.tierLabel == null ? null : this._text(booth.tierLabel, `booth ${index + 1}: tierLabel`, 80, false, true),
    };
  }

  _legend(legend) {
    if (legend == null) return null;
    assertObject(legend, 'legend must be an object or null');
    assertKnownKeys(legend, LEGEND_KEYS, 'legend');
    const orientation = legend.orientation ?? 'auto';
    if (!LEGEND_ORIENTATIONS.has(orientation)) throw new ValidationError('legend.orientation must be auto, horizontal or vertical');
    const tiers = this._array(legend.tiers, 'legend tiers', 20).map((tier, index) => {
      assertObject(tier, `legend tier ${index + 1} must be an object`);
      assertKnownKeys(tier, LEGEND_TIER_KEYS, 'legend tier');
      const swatch = tier.swatch ?? (index % SWATCH_COUNT);
      if (!Number.isInteger(swatch) || swatch < 0 || swatch >= SWATCH_COUNT) {
        throw new ValidationError(`legend tier ${index + 1}: swatch must be 0-${SWATCH_COUNT - 1}`);
      }
      return {
        tierLabel: this._text(tier.tierLabel, `legend tier ${index + 1}: tierLabel`, 80, false, true),
        label: this._text(tier.label ?? tier.tierLabel, `legend tier ${index + 1}: label`, 80, false, true),
        swatch,
      };
    });
    return {
      ...(legend.title ? { title: this._text(legend.title, 'legend.title', 100, false, true) } : {}),
      orientation,
      tiers,
    };
  }

  _metadata(metadata) {
    if (metadata == null) return null;
    assertObject(metadata, 'metadata must be an object or null');
    assertKnownKeys(metadata, METADATA_KEYS, 'metadata');
    const result = {};
    if (metadata.eventTitle != null) result.eventTitle = this._text(metadata.eventTitle, 'metadata.eventTitle', 200, false);
    if (metadata.subtitle != null) result.subtitle = this._text(metadata.subtitle, 'metadata.subtitle', 200, false);
    if (metadata.brandColor != null) {
      if (typeof metadata.brandColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(metadata.brandColor)) {
        throw new ValidationError('metadata.brandColor must be a hex colour (#RRGGBB)');
      }
      result.brandColor = metadata.brandColor.toUpperCase();
    }
    if (metadata.themeMode != null) {
      if (!['LIGHT', 'DARK', 'SYSTEM'].includes(metadata.themeMode)) {
        throw new ValidationError('metadata.themeMode must be LIGHT, DARK, or SYSTEM');
      }
      result.themeMode = metadata.themeMode;
    }
    return result;
  }

  _id(value, kind, index) {
    if (value === undefined) return `${kind}-${String(index + 1).padStart(3, '0')}`;
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
      throw new ValidationError(`${kind} ${index + 1}: id must contain only letters, numbers, _ or -`);
    }
    return value;
  }

  _uniqueIds(items, kind) {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item.id)) throw new ValidationError(`Duplicate ${kind} id: ${item.id}`);
      seen.add(item.id);
    }
  }

  _text(value, name, max, nullable = false, required = false) {
    if (value === null && nullable) return null;
    if (typeof value !== 'string') throw new ValidationError(`${name} must be a string${nullable ? ' or null' : ''}`);
    const text = value.trim();
    if ((required && !text) || text.length > max) throw new ValidationError(`${name} must be ${required ? `1-${max}` : `at most ${max}`} characters`);
    return text;
  }

  _validateName(name) {
    const value = String(name ?? '').trim();
    if (value.length < 2 || value.length > 80) throw new ValidationError('name must be 2-80 characters');
    return value;
  }

  async _write(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error?.code === 'P2002') throw new ConflictError('A map template with that name already exists');
      throw error;
    }
  }

  _serializeSummary(template, withOrganization = false) {
    return {
      id: template.id,
      name: template.name,
      width: template.definition?.width ?? null,
      height: template.definition?.height ?? null,
      boothCount: (template.definition?.booths || []).length,
      zoneCount: (template.definition?.zones || []).length,
      elementCount: (template.definition?.elements || []).length,
      sourceMapId: template.sourceMapId,
      ...(withOrganization && template.organization ? { organization: template.organization } : {}),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  _serialize(template) {
    return {
      id: template.id,
      organizationId: template.organizationId,
      name: template.name,
      definition: template.definition,
      sourceMapId: template.sourceMapId,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}

export default new FloorMapTemplateService();
