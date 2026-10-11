// Volunteer shifts (spec 050 §6.4, card 050-R).
//
// Shifts (or roles without a time) live on a VOLUNTEER form. Applicants pick
// any of them as preferences, full ones included; capacity counts only the
// picks an organizer assigned on approval, so a popular shift never refuses
// an application. Assignment locks each shift row (`SELECT … FOR UPDATE`),
// the same rule as PriceTier capacity. Shifts carry no money.

import { prisma } from '@jump/db';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const MAX_SHIFTS_PER_FORM = 100;

function coded(error, code) {
  error.code = code;
  return error;
}

/** Include for a form's shifts with the assigned count each. */
export const SHIFTS_INCLUDE = {
  orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
  include: { _count: { select: { picks: { where: { assigned: true } } } } },
};
const SHIFTS_INCLUDE_ONE = { include: SHIFTS_INCLUDE.include };

function remainingOf(shift) {
  if (shift.capacity == null) return null;
  return Math.max(0, shift.capacity - (shift._count?.picks ?? 0));
}

class VolunteerShiftService {
  /** Event form, scoped to the caller's organization; 400 unless it is a VOLUNTEER form. */
  async _requireVolunteerForm(eventId, formId, organizationId) {
    const form = await prisma.applicationForm.findFirst({
      where: { id: formId, eventId, ...(organizationId && { event: { venue: { organizationId } } }) },
      select: { id: true, purpose: true },
    });
    if (!form) throw new NotFoundError('Application form not found');
    if (form.purpose !== 'VOLUNTEER') throw coded(new ValidationError('Only volunteer forms have shifts'), 'NOT_VOLUNTEER_FORM');
    return form;
  }

  async list(eventId, formId, organizationId) {
    await this._requireVolunteerForm(eventId, formId, organizationId);
    const shifts = await prisma.volunteerShift.findMany({ where: { formId }, ...SHIFTS_INCLUDE });
    return shifts.map((s) => this.serialize(s));
  }

  async create(eventId, formId, organizationId, body) {
    await this._requireVolunteerForm(eventId, formId, organizationId);
    const count = await prisma.volunteerShift.count({ where: { formId } });
    if (count >= MAX_SHIFTS_PER_FORM) throw new ValidationError(`At most ${MAX_SHIFTS_PER_FORM} shifts per form`);
    const data = this._validate(body, {}, count);
    const shift = await prisma.volunteerShift.create({ data: { formId, ...data }, ...SHIFTS_INCLUDE_ONE });
    return this.serialize(shift);
  }

  async update(eventId, formId, shiftId, organizationId, body) {
    await this._requireVolunteerForm(eventId, formId, organizationId);
    const shift = await prisma.$transaction(async (tx) => {
      // Same lock as approval (`assign`), so the assigned count cannot move under the check.
      const locked = await tx.$queryRaw`SELECT "id" FROM "VolunteerShift" WHERE "id" = ${shiftId} AND "formId" = ${formId} FOR UPDATE`;
      if (!locked[0]) throw new NotFoundError('Shift not found');
      const existing = await tx.volunteerShift.findUnique({ where: { id: shiftId } });
      const data = this._validate(body, existing, existing.displayOrder);
      if (data.capacity != null) {
        const assigned = await tx.applicationShift.count({ where: { shiftId, assigned: true } });
        if (data.capacity < assigned) {
          throw coded(new ConflictError(`Capacity cannot be below the ${assigned} volunteers already assigned`, { assigned }), 'SHIFT_CAPACITY_BELOW_ASSIGNED');
        }
      }
      return tx.volunteerShift.update({ where: { id: shiftId }, data, ...SHIFTS_INCLUDE_ONE });
    });
    return this.serialize(shift);
  }

  /**
   * Delete under the shift lock. Assigned volunteers block it (409); picks of
   * rejected or withdrawn applications, and unassigned preferences, go with it.
   */
  async remove(eventId, formId, shiftId, organizationId) {
    await this._requireVolunteerForm(eventId, formId, organizationId);
    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT "id" FROM "VolunteerShift" WHERE "id" = ${shiftId} AND "formId" = ${formId} FOR UPDATE`;
      if (!locked[0]) throw new NotFoundError('Shift not found');
      const assigned = await tx.applicationShift.count({ where: { shiftId, assigned: true } });
      if (assigned > 0) throw coded(new ConflictError('Volunteers are assigned to this shift; move them off it first', { assigned }), 'SHIFT_HAS_ASSIGNED');
      await tx.applicationShift.deleteMany({ where: { shiftId } });
      await tx.volunteerShift.delete({ where: { id: shiftId } });
    });
  }

  /**
   * Validate a full or partial body against `existing` (the merged result
   * must be coherent: an end needs a start and must come after it).
   */
  _validate(body, existing, displayOrder) {
    const data = {};
    const merged = { ...existing, ...body };
    const name = String(merged.name ?? '').trim();
    if (name.length < 1 || name.length > 80) throw new ValidationError('shift name must be 1-80 characters');
    data.name = name;
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') throw new ValidationError('description must be a string');
      const d = body.description?.trim() || null;
      if (d && d.length > 500) throw new ValidationError('description must be at most 500 characters');
      data.description = d;
    }
    for (const key of ['startsAt', 'endsAt']) {
      if (body[key] === undefined) continue;
      if (body[key] === null || body[key] === '') data[key] = null;
      else {
        const date = typeof body[key] === 'string' ? new Date(body[key]) : null;
        if (!date || Number.isNaN(date.getTime())) throw new ValidationError(`${key} must be an ISO date-time`);
        data[key] = date;
      }
    }
    const startsAt = data.startsAt !== undefined ? data.startsAt : existing.startsAt ?? null;
    const endsAt = data.endsAt !== undefined ? data.endsAt : existing.endsAt ?? null;
    if (endsAt && !startsAt) throw new ValidationError('a shift with an end time needs a start time');
    if (startsAt && endsAt && endsAt <= startsAt) throw new ValidationError('endsAt must be after startsAt');
    if (body.capacity !== undefined) {
      if (body.capacity !== null && (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 100000)) {
        throw new ValidationError('capacity must be a whole number of at least 1, or null for unlimited');
      }
      data.capacity = body.capacity;
    }
    if (body.displayOrder !== undefined) {
      if (!Number.isInteger(body.displayOrder) || body.displayOrder < 0) throw new ValidationError('displayOrder must be a non-negative integer');
      data.displayOrder = body.displayOrder;
    } else if (!existing.id) data.displayOrder = displayOrder;
    return data;
  }

  /** Staff shape: capacity, assigned count, remaining (null = unlimited). */
  serialize(s) {
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      startsAt: s.startsAt ?? null,
      endsAt: s.endsAt ?? null,
      capacity: s.capacity ?? null,
      assigned: s._count?.picks ?? 0,
      remaining: remainingOf(s),
      displayOrder: s.displayOrder,
    };
  }

  /** Applicant shape: no counters beyond what is left. A full shift can still be picked as a preference. */
  serializePublic(s) {
    const remaining = remainingOf(s);
    return {
      id: s.id,
      name: s.name,
      description: s.description ?? null,
      startsAt: s.startsAt ?? null,
      endsAt: s.endsAt ?? null,
      remaining,
      full: remaining === 0,
    };
  }

  /**
   * Picks on a submission: unique ids of this form's shifts. Only VOLUNTEER
   * forms take them; full shifts are accepted (they are preferences).
   */
  async validatePicks(form, shiftIds) {
    if (shiftIds === undefined || shiftIds === null) return [];
    if (!Array.isArray(shiftIds) || shiftIds.some((id) => typeof id !== 'string' || !id)) throw new ValidationError('shiftIds must be an array of shift ids');
    const ids = [...new Set(shiftIds)];
    if (ids.length === 0) return [];
    if (form.purpose !== 'VOLUNTEER') throw coded(new ValidationError('This form has no shifts'), 'NOT_VOLUNTEER_FORM');
    const known = await prisma.volunteerShift.count({ where: { formId: form.id, id: { in: ids } } });
    if (known !== ids.length) throw new ValidationError('shiftIds must be shifts of this form');
    return ids;
  }

  /**
   * Approval: make `shiftIds` this application's assigned shifts, inside the
   * decision transaction. Each shift row is locked in id order (no deadlock
   * between two approvals), then its assigned count is read; a capped shift
   * with no room is 409 SHIFT_FULL naming every full shift. Shifts the
   * organizer assigns without an applicant pick are added as picks.
   */
  async assign(tx, application, form, shiftIds) {
    if (!Array.isArray(shiftIds) || shiftIds.some((id) => typeof id !== 'string' || !id)) throw new ValidationError('shiftIds must be an array of shift ids');
    const ids = [...new Set(shiftIds)].sort();
    if (ids.length > 0 && form.purpose !== 'VOLUNTEER') throw coded(new ValidationError('This form has no shifts'), 'NOT_VOLUNTEER_FORM');
    if (ids.length > 0) {
      const locked = await tx.$queryRaw`
        SELECT "id", "name", "capacity" FROM "VolunteerShift"
        WHERE "formId" = ${application.formId} AND "id" = ANY(${ids}::text[])
        ORDER BY "id" FOR UPDATE`;
      if (locked.length !== ids.length) throw new ValidationError('shiftIds must be shifts of this form');
      const capped = locked.filter((s) => s.capacity != null);
      const counts = capped.length
        ? await tx.applicationShift.groupBy({
            by: ['shiftId'],
            where: { shiftId: { in: capped.map((s) => s.id) }, assigned: true, applicationId: { not: application.id } },
            _count: { _all: true },
          })
        : [];
      const taken = new Map(counts.map((c) => [c.shiftId, c._count._all]));
      const full = capped.filter((s) => (taken.get(s.id) ?? 0) >= s.capacity);
      if (full.length > 0) {
        throw coded(
          new ConflictError(`${full.map((s) => s.name).join(', ')} ${full.length === 1 ? 'is' : 'are'} full. Untick ${full.length === 1 ? 'it' : 'them'} or raise the capacity.`, {
            shiftIds: full.map((s) => s.id),
          }),
          'SHIFT_FULL'
        );
      }
    }
    await tx.applicationShift.updateMany({ where: { applicationId: application.id, assigned: true, shiftId: { notIn: ids } }, data: { assigned: false } });
    if (ids.length === 0) return;
    await tx.applicationShift.createMany({ data: ids.map((shiftId) => ({ applicationId: application.id, shiftId })), skipDuplicates: true });
    await tx.applicationShift.updateMany({ where: { applicationId: application.id, shiftId: { in: ids } }, data: { assigned: true } });
  }

  /** Leaving APPROVED hands assigned shifts back (the picks stay as history). */
  async unassignAll(tx, applicationId) {
    await tx.applicationShift.updateMany({ where: { applicationId, assigned: true }, data: { assigned: false } });
  }

  /** "Gate crew (assigned); Setup" — the CSV cell. Times are on the shifts list, not repeated per row. */
  csvCell(picks = []) {
    return picks.map((p) => `${p.shift.name}${p.assigned ? ' (assigned)' : ''}`).join('; ');
  }
}

export default new VolunteerShiftService();
