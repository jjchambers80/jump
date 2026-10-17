// Spec 050 §6.3 (050-Q), gotcha 30: lineup rows copied from a contact's
// application appear in their data export and go with erasure (an APPROVED
// application blocks erasure, so the fixture's was withdrawn after the copy). Rows typed by
// hand (no application) are organizer content and stay.

const { prisma } = await import('@jump/db');
const { default: buyerDataExportService } = await import('../../src/services/BuyerDataExportService.js');
const { default: contactErasureService } = await import('../../src/services/ContactErasureService.js');

const TAG = `guest-rights-${process.pid}-${Date.now()}`;

describe('Event guest lineup data rights', () => {
  let org;
  let eventId;
  let contact;
  let linked;
  let manual;

  beforeAll(async () => {
    org = await prisma.organization.create({ data: { name: `${TAG} Org` } });
    const venue = await prisma.venue.create({ data: { organizationId: org.id, name: 'Hall', address: '1 Main St', city: 'Raleigh', state: 'NC', timezone: 'America/New_York' } });
    eventId = (await prisma.event.create({ data: { venueId: venue.id, name: 'Con', date: new Date('2027-09-18T15:00:00Z'), status: 'PUBLISHED', capacity: 10 } })).id;
    const form = await prisma.applicationForm.create({ data: { organizationId: org.id, eventId, name: 'Guests', slug: `g-${TAG}`, kind: 'FREE' } });
    contact = await prisma.contact.create({ data: { organizationId: org.id, email: `mara@${TAG}.test`, firstName: 'Mara', lastName: 'Voss' } });
    const application = await prisma.application.create({ data: { formId: form.id, eventId, organizationId: org.id, contactId: contact.id, status: 'WITHDRAWN', submittedAt: new Date(), statusTokenHash: `${TAG}-st` } });
    linked = await prisma.eventGuest.create({ data: { eventId, applicationId: application.id, name: 'Mara Voss', bio: 'Cosplayer', links: { instagram: 'https://instagram.com/mara' } } });
    manual = await prisma.eventGuest.create({ data: { eventId, name: 'Typed by hand' } });
  });

  afterAll(async () => {
    await prisma.eventGuest.deleteMany({ where: { eventId } }).catch(() => {});
    await prisma.application.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.applicationForm.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contactComment.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.erasureSuppression.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.contact.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.event.deleteMany({ where: { id: eventId } }).catch(() => {});
    await prisma.venue.deleteMany({ where: { organizationId: org.id } }).catch(() => {});
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => {});
  });

  it('export lists the lineup rows linked to the contact’s applications', async () => {
    const data = await buyerDataExportService.build(org.id, contact.id);
    expect(data.applications[0].lineup).toEqual([
      expect.objectContaining({ name: 'Mara Voss', bio: 'Cosplayer', links: { instagram: 'https://instagram.com/mara' }, shownOnEventPage: true }),
    ]);
  });

  it('erasure deletes the linked rows and keeps rows typed by hand', async () => {
    expect(await contactErasureService.erase(contact.id, { organizationId: org.id })).toMatchObject({ status: 'erased' });
    expect(await prisma.eventGuest.findUnique({ where: { id: linked.id } })).toBeNull();
    expect(await prisma.eventGuest.findUnique({ where: { id: manual.id } })).not.toBeNull();
  });
});
