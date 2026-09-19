#!/usr/bin/env node
// One-off (spec 026): pages created before server-side sanitisation existed
// are cleaned in place. Safe to re-run; prints how many rows changed.
//   cd backend && node scripts/sanitize-pages.js

import 'dotenv/config';
import { prisma } from '@jump/db';
import { sanitizeContentHtml } from '../src/utils/sanitizeHtml.js';

const pages = await prisma.page.findMany({ select: { id: true, content: true } });
let changed = 0;
for (const page of pages) {
  const clean = sanitizeContentHtml(page.content);
  if (clean !== page.content) {
    await prisma.page.update({ where: { id: page.id }, data: { content: clean } });
    changed += 1;
  }
}
console.log(`Checked ${pages.length} pages, sanitised ${changed}.`);
await prisma.$disconnect();
