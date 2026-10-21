import { AccountStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { runDatabaseSeed } from '../src/admin/seed.service';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 10;

async function main() {
  console.log('Seeding database...');
  await runDatabaseSeed(prisma);

  // Dedicated Super Admin Seed
  const zayedEmail = 'zzayediqbalofficial@gmail.com';
  const zayedPassword = await bcrypt.hash('Tiberium25', BCRYPT_ROUNDS);
  await prisma.user.upsert({
    where: { email: zayedEmail },
    update: {
      password: zayedPassword,
      fullName: 'Zayed Iqbal (Super Admin)',
      role: Role.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
      publicId: 'ADM-SUPER-ZYD',
      deletedAt: null,
    },
    create: {
      email: zayedEmail,
      password: zayedPassword,
      fullName: 'Zayed Iqbal (Super Admin)',
      role: Role.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
      publicId: 'ADM-SUPER-ZYD',
    },
  });

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
