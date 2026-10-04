// One contender in the multi-process booth race (see boothHoldConcurrency.test.js).
//
// Runs as its own OS process with its own PrismaClient and its own connection
// pool, so nothing about the outcome can come from Node's event loop happening
// to serialize two in-process requests. Every worker sleeps until the same wall
// clock instant and then calls the real BoothService.chooseBooth; Postgres is
// the only thing deciding who wins.
//
// Contract: prints exactly one JSON line to stdout and exits 0, even on a
// rejection — a losing contender is a normal outcome, not a worker failure.

import boothService from '../../src/services/BoothService.js';
import { prisma } from '@jump/db';

const applicationId = process.env.RACE_APPLICATION_ID;
const boothId = process.env.RACE_BOOTH_ID;
const startAt = Number(process.env.RACE_START_AT);

async function main() {
  // Open the pool and warm the connection before the barrier, so the race is
  // over chooseBooth and not over who finishes their TCP handshake first.
  await prisma.$queryRawUnsafe('SELECT 1');

  const wait = startAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  try {
    const hold = await boothService.chooseBooth(applicationId, boothId);
    return { applicationId, won: true, status: hold.status };
  } catch (error) {
    return { applicationId, won: false, code: error.code || null, name: error.name || null };
  }
}

main()
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => process.stdout.write(`${JSON.stringify({ applicationId, won: false, crashed: String(error) })}\n`))
  .finally(async () => {
    await prisma.$disconnect();
  });
