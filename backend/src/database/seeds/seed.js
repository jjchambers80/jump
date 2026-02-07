// Seed database with test data
// Creates 2 admins, 5 customers, and 3 events

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Clear existing data
  await prisma.session.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.event.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.admin.deleteMany();

  // Create admins
  const hashedPassword = await bcrypt.hash('password123', 10);

  const admin1 = await prisma.admin.create({
    data: {
      email: 'admin1@jump.com',
      name: 'Alice Admin',
      organization: 'Jump Tickets Inc',
      passwordHash: hashedPassword,
    },
  });

  const admin2 = await prisma.admin.create({
    data: {
      email: 'admin2@jump.com',
      name: 'Bob Organizer',
      organization: 'Event Masters LLC',
      passwordHash: hashedPassword,
    },
  });

  console.log('✅ Created 2 admins');

  // Create customers
  const customers = [];
  for (let i = 1; i <= 5; i++) {
    const customer = await prisma.customer.create({
      data: {
        email: `customer${i}@jump.com`,
        name: `Customer ${i}`,
        passwordHash: hashedPassword,
      },
    });
    customers.push(customer);
  }

  console.log('✅ Created 5 customers');

  // Create events
  const today = new Date();
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);

  const twoMonthsOut = new Date(today);
  twoMonthsOut.setMonth(twoMonthsOut.getMonth() + 2);

  const threeMonthsOut = new Date(today);
  threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);

  await prisma.event.create({
    data: {
      organizerId: admin1.id,
      name: 'Tech Conference 2024',
      date: nextMonth,
      venue: 'Convention Center, San Francisco',
      capacity: 1000,
      ticketPrice: 5000, // $50.00
      status: 'DRAFT',
    },
  });

  await prisma.event.create({
    data: {
      organizerId: admin1.id,
      name: 'Summer Music Festival',
      date: twoMonthsOut,
      venue: 'Golden Gate Park, San Francisco',
      capacity: 5000,
      ticketPrice: 7500, // $75.00
      status: 'PUBLISHED',
    },
  });

  await prisma.event.create({
    data: {
      organizerId: admin2.id,
      name: 'Startup Pitch Night',
      date: threeMonthsOut,
      venue: 'Innovation Hub, Palo Alto',
      capacity: 100,
      ticketPrice: 2500, // $25.00
      status: 'PUBLISHED',
    },
  });

  console.log('✅ Created 3 events (1 DRAFT, 2 PUBLISHED)');

  console.log('🎉 Seed completed successfully!');
  console.log('\nTest credentials:');
  console.log('  Admins: admin1@jump.com, admin2@jump.com');
  console.log('  Customers: customer1@jump.com through customer5@jump.com');
  console.log('  Password for all: password123');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
