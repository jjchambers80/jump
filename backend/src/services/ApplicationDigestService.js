// Application Digest Service (spec 011 phase 3)
// Once a day, email every member of an organization a summary of the
// applications submitted since the last digest, grouped by event and form.
// Runs from the hourly application sweep in server.js; each organization
// keeps `applicationDigestAt` (end of the last window) so restarts and
// overlapping sweeps never double-send. Organizations opt out with
// `applicationDigestEnabled`; nothing is sent for a window with no
// submissions, but the window still advances.

import { hasLiveOrder } from './applicationOrderStatus.js';
import { prisma } from '@jump/db';
import emailService from './EmailService.js';
import { platformBaseUrl } from '../utils/storefrontUrl.js';
import logger from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// A digest is due once the last one is at least this old. Slightly under a
// day so an hourly sweep sends at the same hour each day instead of drifting.
const MIN_GAP_MS = 23 * 60 * 60 * 1000;
const MAX_ROWS_PER_FORM = 25;

function money(value) {
  return `$${Number(value).toFixed(2)}`;
}

class ApplicationDigestService {
  /**
   * Send every due digest. Returns { organizations, sent } for logging/tests.
   * `organizationId` narrows the sweep to one organization: sending a digest
   * spends that organization's window, so a caller that only cares about its
   * own rows must say so rather than claiming everybody else's. The contract
   * suites run in parallel against one database and rely on this.
   */
  async sendDue(now = new Date(), { organizationId } = {}) {
    const orgs = await prisma.organization.findMany({
      where: {
        ...(organizationId ? { id: organizationId } : {}),
        applicationDigestEnabled: true,
        status: 'ACTIVE',
        OR: [{ applicationDigestAt: null }, { applicationDigestAt: { lte: new Date(now.getTime() - MIN_GAP_MS) } }],
      },
      select: { id: true, name: true, applicationDigestAt: true },
    });
    let sent = 0;
    for (const org of orgs) {
      try {
        if (await this.sendForOrganization(org, now)) sent += 1;
      } catch (error) {
        logger.error('Application digest failed', { organizationId: org.id, error: error.message });
      }
    }
    if (orgs.length) logger.info('Application digest sweep', { event: 'application_digest_sweep', organizations: orgs.length, sent });
    return { organizations: orgs.length, sent };
  }

  /**
   * Send one organization's digest for the window (applicationDigestAt ??
   * now - 24h, now]. Advances the window even when there is nothing to send.
   * @returns {Promise<boolean>} whether an email went out
   */
  async sendForOrganization(org, now = new Date()) {
    const since = org.applicationDigestAt ?? new Date(now.getTime() - DAY_MS);
    // Claim the window first so a concurrent sweep skips this organization.
    const claimed = await prisma.organization.updateMany({
      where: { id: org.id, applicationDigestAt: org.applicationDigestAt },
      data: { applicationDigestAt: now },
    });
    if (claimed.count === 0) return false;

    const rows = await prisma.application.findMany({
      where: { organizationId: org.id, status: { not: 'DRAFT' }, submittedAt: { gt: since, lte: now } },
      include: {
        event: { select: { id: true, name: true } },
        form: { select: { id: true, name: true, kind: true } },
        tier: { select: { name: true } },
        profile: { select: { businessName: true } },
        contact: { select: { firstName: true, lastName: true } },
        order: {
          select: {
            status: true,
            totalAmount: true,
            addOns: {
              select: { quantity: true, name: true, addOn: { select: { name: true, displayOrder: true } } },
              orderBy: { addOn: { displayOrder: 'asc' } },
            },
          },
        },
      },
      orderBy: [{ eventId: 'asc' }, { formId: 'asc' }, { submittedAt: 'asc' }],
    });
    if (rows.length === 0) return false;
    // Spec 037 phase 5: only a live order is what the vendor chose (an expired selection gave its lines back).
    for (const a of rows) if (!hasLiveOrder(a)) a.order = null;

    const recipients = await this.recipients(org.id);
    if (recipients.length === 0) return false;

    // Spec 037 phase 5: approved vendors who have not chosen and paid for a
    // space yet (holding one while paying still counts: it is not theirs yet).
    const awaitingSpace = await prisma.application.count({
      where: { organizationId: org.id, status: 'APPROVED', paymentStatus: { in: ['AWAITING_SELECTION', 'PAYMENT_DUE', 'PROCESSING'] }, form: { kind: 'PAID' } },
    });

    const { subject, body } = this.compose(org, rows, since, now, { awaitingSpace });
    for (const to of recipients) {
      try {
        await emailService.sendApplicationMessage({ to, subject, body, organization: { name: org.name }, staff: true });
      } catch (error) {
        logger.error('Application digest email failed', { organizationId: org.id, to, error: error.message });
      }
    }
    logger.info('Application digest sent', { event: 'application_digest_sent', organizationId: org.id, applications: rows.length, recipients: recipients.length });
    return true;
  }

  /** Member emails (ORGANIZER and ADMIN) for an organization, deduplicated. */
  async recipients(organizationId) {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId },
      select: { user: { select: { email: true } } },
    });
    return [...new Set(members.map((m) => m.user?.email).filter(Boolean))];
  }

  /**
   * Plain-text digest grouped by event then form. Rendered through the
   * branded shell by EmailService.sendApplicationMessage, which escapes
   * every line and turns the review URL into a button.
   */
  compose(org, rows, since, now, { awaitingSpace = 0 } = {}) {
    const base = platformBaseUrl();
    const byEvent = new Map();
    for (const a of rows) {
      const key = a.event?.id ?? 'standing';
      if (!byEvent.has(key)) byEvent.set(key, { event: a.event, forms: new Map() });
      const forms = byEvent.get(key).forms;
      if (!forms.has(a.form.id)) forms.set(a.form.id, { form: a.form, rows: [] });
      forms.get(a.form.id).rows.push(a);
    }

    const count = rows.length;
    const subject = `${count} new application${count === 1 ? '' : 's'} — ${org.name}`;
    const parts = [`${count} new application${count === 1 ? '' : 's'} came in between ${since.toUTCString()} and ${now.toUTCString()}.`];
    // Spec 037 D3: applications are reviewed per event — each event links to
    // its own queue; the button at the end opens the events list.
    for (const { event, forms } of byEvent.values()) {
      parts.push(event
        ? `${event.name}\n${base}/admin/events/${event.id}/applications?status=SUBMITTED`
        : `Standing forms\n${base}/admin/content/forms`);
      for (const { form, rows: list } of forms.values()) {
        const lines = [`${form.name}: ${list.length}`];
        // Add-on counts across the form's new applications (spec 012 phase 3)
        const addOnTotals = new Map();
        for (const a of list) {
          for (const l of a.order?.addOns || []) {
            const name = l.name ?? l.addOn.name; // spec 037: the line's snapshot
            const t = addOnTotals.get(name) ?? { quantity: 0, order: l.addOn.displayOrder };
            t.quantity += l.quantity;
            addOnTotals.set(name, t);
          }
        }
        if (addOnTotals.size) {
          const summary = [...addOnTotals.entries()].sort((x, y) => x[1].order - y[1].order).map(([name, t]) => `${name} ×${t.quantity}`).join(', ');
          lines.push(`Add-ons requested: ${summary}`);
        }
        for (const a of list.slice(0, MAX_ROWS_PER_FORM)) {
          const who = `${a.contact.firstName} ${a.contact.lastName}`.trim();
          const addOns = (a.order?.addOns || [])
            .map((l) => `${l.name ?? l.addOn.name} ×${l.quantity}`)
            .join(', ');
          const extra = [
            a.tier?.name,
            addOns || null,
            form.kind === 'PAID' && Number(a.order?.totalAmount) > 0
              ? money(a.order.totalAmount)
              : null,
          ]
            .filter(Boolean)
            .join(', ');
          lines.push(`- ${a.profile?.businessName || who} (${who})${extra ? ` — ${extra}` : ''}`);
        }
        if (list.length > MAX_ROWS_PER_FORM) lines.push(`…and ${list.length - MAX_ROWS_PER_FORM} more`);
        parts.push(lines.join('\n'));
      }
    }
    if (awaitingSpace > 0) {
      parts.push(`Approved, awaiting space: ${awaitingSpace} vendor${awaitingSpace === 1 ? '' : 's'} still need${awaitingSpace === 1 ? 's' : ''} to choose and pay for a space.\n${base}/admin/events`);
    }
    parts.push(`${base}/admin/events`);
    parts.push(`You get this daily summary because you are a member of ${org.name}. Turn it off under Settings › Applications.`);
    return { subject, body: parts.join('\n\n') };
  }

  async getSettings(organizationId) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { applicationDigestEnabled: true, applicationDigestAt: true } });
    return { enabled: org?.applicationDigestEnabled ?? true, lastRunAt: org?.applicationDigestAt ?? null };
  }

  async updateSettings(organizationId, { enabled }) {
    await prisma.organization.update({ where: { id: organizationId }, data: { applicationDigestEnabled: enabled } });
    return this.getSettings(organizationId);
  }
}

export default new ApplicationDigestService();
