import { normalizeEmail } from '../utils/normalizeEmail.js';

/**
 * Find or create the organization's Contact for an email (spec 007), filling
 * in a missing name only (spec 037 D12 / C4). An existing name is never
 * overwritten: a second buyer on a shared address must not rename the first,
 * and a staff edit on the customer page must survive the next purchase.
 *
 * Shared by checkout, application submit and RSVP so the rule lives once.
 *
 * @param {object} tx - Prisma client or transaction client
 * @param {{ organizationId: string, email: string, firstName?: string, lastName?: string }} input
 * @returns {Promise<object>} the Contact row
 */
export async function upsertContactFillBlanks(tx, { organizationId, email, firstName, lastName }) {
  const normalized = normalizeEmail(email);
  // An upsert with an empty update is an atomic find-or-create, safe under
  // concurrent checkouts for one address (find-then-create races the unique).
  let contact = await tx.contact.upsert({
    where: { organizationId_email: { organizationId, email: normalized } },
    update: {},
    create: {
      organizationId,
      email: normalized,
      firstName: firstName ?? '',
      lastName: lastName ?? '',
    },
  });

  const fill = {};
  if (!contact.firstName?.trim() && firstName?.trim()) fill.firstName = firstName;
  if (!contact.lastName?.trim() && lastName?.trim()) fill.lastName = lastName;
  if (Object.keys(fill).length) {
    contact = await tx.contact.update({ where: { id: contact.id }, data: fill });
  }
  return contact;
}

export default upsertContactFillBlanks;
