import { PrismaClient } from '@prisma/client';
import { runDatabaseSeed } from '../src/admin/seed.service';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database from environment configuration...');
  await runDatabaseSeed(prisma);
  console.log('Database seeded successfully.');
}

main()
  .catch((e) => {
    console.error('Database seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
