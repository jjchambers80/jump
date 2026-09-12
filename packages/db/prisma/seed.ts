// packages/db/prisma/seed.ts
// Seed data for Schema Redesign — MVP Data Architecture
// Creates: 1 org, 2 venues, 1 admin, 2 organizers, 2 customers, 3 events, 2 contacts, 1 completed order with tickets

import {
  PrismaClient,
  UserRole,
  EventStatus,
  OrderStatus,
  TicketStatus,
  PaymentStatus,
} from "../generated/client/index.js";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Clean up existing data (order matters for FK constraints)
  await prisma.paymentTransaction.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.order.deleteMany();
  await prisma.priceTier.deleteMany();
  await prisma.event.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // 1. Organization
  const org = await prisma.organization.create({
    data: {
      name: "Jump Events Co.",
      brandColor: "#047857", // emerald-700 — passes WCAG AA, shows brand inheritance locally
      themeMode: "DARK", // default is SYSTEM; DARK makes enforcement visible in local QA
    },
  });
  console.log(`  ✅ Organization: ${org.name} (${org.id})`);

  // 2. Venues
  const venue1 = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: "Madison Square Garden",
      address: "4 Pennsylvania Plaza, New York, NY 10001",
      timezone: "America/New_York",
      isPublic: true,
    },
  });

  const venue2 = await prisma.venue.create({
    data: {
      organizationId: org.id,
      name: "The Fillmore",
      address: "1805 Geary Blvd, San Francisco, CA 94115",
      timezone: "America/Los_Angeles",
      isPublic: true,
    },
  });
  console.log(`  ✅ Venues: ${venue1.name}, ${venue2.name}`);

  // 3. Users
  const adminUser = await prisma.user.create({
    data: {
      email: "admin@jump.events",
      name: "Admin User",
      firstName: "Admin",
      lastName: "User",
      role: UserRole.ADMIN,
      organizationId: org.id,
      emailVerified: new Date(),
    },
  });

  const organizer1 = await prisma.user.create({
    data: {
      email: "organizer1@jump.events",
      name: "Sarah Organizer",
      firstName: "Sarah",
      lastName: "Organizer",
      role: UserRole.ORGANIZER,
      organizationId: org.id,
      emailVerified: new Date(),
    },
  });

  const organizer2 = await prisma.user.create({
    data: {
      email: "organizer2@jump.events",
      name: "Mike Organizer",
      firstName: "Mike",
      lastName: "Organizer",
      role: UserRole.ORGANIZER,
      organizationId: org.id,
      emailVerified: new Date(),
    },
  });

  const customer1 = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice Customer",
      firstName: "Alice",
      lastName: "Customer",
      role: UserRole.CUSTOMER,
      emailVerified: new Date(),
    },
  });

  const customer2 = await prisma.user.create({
    data: {
      email: "bob@example.com",
      name: "Bob Customer",
      firstName: "Bob",
      lastName: "Customer",
      role: UserRole.CUSTOMER,
      emailVerified: new Date(),
    },
  });
  console.log(`  ✅ Users: admin, 2 organizers, 2 customers`);

  // 4. Events with Price Tiers
  // Event 1: DRAFT (upcoming, at MSG)
  const futureDate1 = new Date();
  futureDate1.setMonth(futureDate1.getMonth() + 2);

  const event1 = await prisma.event.create({
    data: {
      venueId: venue1.id,
      name: "Summer Music Festival",
      description: "A three-day music festival featuring top artists",
      date: futureDate1,
      capacity: 5000,
      category: "Music",
      status: EventStatus.DRAFT,
      priceTiers: {
        create: [
          {
            name: "Early Bird",
            price: 49.99,
            quantityTotal: 1000,
            displayOrder: 0,
            minPerOrder: 1,
            maxPerOrder: 4,
          },
          {
            name: "General Admission",
            price: 79.99,
            quantityTotal: 3000,
            displayOrder: 1,
            minPerOrder: 1,
            maxPerOrder: 8,
          },
          {
            name: "VIP",
            price: 149.99,
            quantityTotal: 500,
            displayOrder: 2,
            minPerOrder: 1,
            maxPerOrder: 2,
          },
        ],
      },
    },
  });
  console.log(`  ✅ Event (DRAFT): ${event1.name}`);

  // Event 2: PUBLISHED (upcoming, at MSG)
  const futureDate2 = new Date();
  futureDate2.setMonth(futureDate2.getMonth() + 1);

  const event2 = await prisma.event.create({
    data: {
      venueId: venue1.id,
      name: "Rock Night Live",
      description: "An electrifying night of rock music",
      date: futureDate2,
      capacity: 2000,
      category: "Music",
      status: EventStatus.PUBLISHED,
      priceTiers: {
        create: [
          {
            name: "Standing",
            price: 35.0,
            quantityTotal: 1500,
            quantitySold: 150,
            displayOrder: 0,
            minPerOrder: 1,
            maxPerOrder: 6,
          },
          {
            name: "Premium",
            price: 75.0,
            quantityTotal: 500,
            quantitySold: 50,
            displayOrder: 1,
            minPerOrder: 1,
            maxPerOrder: 4,
          },
        ],
      },
    },
  });
  console.log(`  ✅ Event (PUBLISHED): ${event2.name}`);

  // Event 3: PUBLISHED (upcoming, at The Fillmore)
  const futureDate3 = new Date();
  futureDate3.setMonth(futureDate3.getMonth() + 3);

  const event3 = await prisma.event.create({
    data: {
      venueId: venue2.id,
      name: "Comedy Night Special",
      description: "Stand-up comedy with headline performers",
      date: futureDate3,
      capacity: 800,
      category: "Comedy",
      status: EventStatus.PUBLISHED,
      priceTiers: {
        create: [
          {
            name: "General",
            price: 25.0,
            quantityTotal: 600,
            quantitySold: 75,
            displayOrder: 0,
          },
          {
            name: "Front Row",
            price: 50.0,
            quantityTotal: 200,
            quantitySold: 20,
            displayOrder: 1,
            maxPerOrder: 2,
          },
        ],
      },
    },
  });
  console.log(`  ✅ Event (PUBLISHED): ${event3.name}`);

  // 5. Contacts
  const contact1 = await prisma.contact.create({
    data: {
      email: "alice@example.com",
      firstName: "Alice",
      lastName: "Customer",
      userId: customer1.id,
    },
  });

  const contact2 = await prisma.contact.create({
    data: {
      email: "guest@example.com",
      firstName: "Guest",
      lastName: "Buyer",
      // No userId — guest purchaser
    },
  });
  console.log(`  ✅ Contacts: ${contact1.email}, ${contact2.email}`);

  // 6. Sample completed order with tickets (for event2)
  const event2Tiers = await prisma.priceTier.findMany({
    where: { eventId: event2.id },
    orderBy: { displayOrder: "asc" },
  });

  const standingTier = event2Tiers[0];

  const order = await prisma.order.create({
    data: {
      eventId: event2.id,
      contactId: contact1.id,
      orderRef: "JMP-A1B2C3",
      totalAmount: 70.0,
      currency: "usd",
      quantity: 2,
      status: OrderStatus.COMPLETED,
      stripeSessionId: "cs_test_sample_session_id",
    },
  });

  // Create 2 tickets for the order
  const ticket1 = await prisma.ticket.create({
    data: {
      orderId: order.id,
      eventId: event2.id,
      priceTierId: standingTier.id,
      contactId: contact1.id,
      pricePaid: 35.0,
      barcode: "JUMP-000000000001",
      ticketNumber: 1,
      status: TicketStatus.VALID,
    },
  });

  const ticket2 = await prisma.ticket.create({
    data: {
      orderId: order.id,
      eventId: event2.id,
      priceTierId: standingTier.id,
      contactId: contact1.id,
      pricePaid: 35.0,
      barcode: "JUMP-000000000002",
      ticketNumber: 2,
      status: TicketStatus.VALID,
    },
  });

  // Create payment transaction (append-only)
  await prisma.paymentTransaction.create({
    data: {
      orderId: order.id,
      stripePaymentIntentId: "pi_test_sample_payment_intent",
      amount: 70.0,
      currency: "usd",
      status: PaymentStatus.SUCCEEDED,
    },
  });

  console.log(`  ✅ Order: ${order.orderRef} with 2 tickets`);

  console.log("\n🎉 Seed completed successfully!");
  console.log(`
Summary:
  Organizations: 1
  Venues: 2
  Users: 5 (1 admin, 2 organizers, 2 customers)
  Events: 3 (1 DRAFT, 2 PUBLISHED)
  Price Tiers: 7
  Contacts: 2
  Orders: 1 (COMPLETED)
  Tickets: 2
  Payment Transactions: 1
  `);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
