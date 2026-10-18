import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccountStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { internalCashierEmail } from '../users/user-profile.select';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;

export async function runDatabaseSeed(
  prisma: PrismaClient | PrismaService,
): Promise<void> {
  // 1. Super Admin Account
  const superAdminEmail = (
    process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@suntech.pos'
  )
    .trim()
    .toLowerCase();
  const superAdminPassword = await bcrypt.hash(
    process.env.SUPER_ADMIN_PASSWORD ?? 'SuperAdmin@123',
    BCRYPT_ROUNDS,
  );

  await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: {
      fullName: 'SunTech Super Admin',
      role: Role.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
      publicId: 'ADM-SUPER',
      deletedAt: null,
    },
    create: {
      email: superAdminEmail,
      password: superAdminPassword,
      fullName: 'SunTech Super Admin',
      role: Role.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
      publicId: 'ADM-SUPER',
    },
  });

  // 2. Default Approved Admin
  const adminEmail = 'admin@suntechpos.bd';
  const adminPassword = await bcrypt.hash('Admin@1234', BCRYPT_ROUNDS);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      fullName: 'SunTech Admin',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      publicId: 'ADM-8X9B2',
      deletedAt: null,
    },
    create: {
      email: adminEmail,
      password: adminPassword,
      fullName: 'SunTech Admin',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      publicId: 'ADM-8X9B2',
    },
  });

  // 3. Default Business
  let business = await prisma.business.findUnique({
    where: { ownerId: admin.id },
  });

  if (!business) {
    business = await prisma.business.create({
      data: {
        name: 'SunTech Retail',
        ownerId: admin.id,
      },
    });
  } else {
    business = await prisma.business.update({
      where: { id: business.id },
      data: {
        name: 'SunTech Retail',
        deletedAt: null,
      },
    });
  }

  // Link admin.businessId = business.id
  await prisma.user.update({
    where: { id: admin.id },
    data: { businessId: business.id },
  });

  // 4. Default Location
  let location = await prisma.location.findFirst({
    where: {
      businessId: business.id,
      name: 'Uttara Doyel Branch',
    },
  });

  if (!location) {
    location = await prisma.location.create({
      data: {
        name: 'Uttara Doyel Branch',
        address: 'Uttara, Dhaka',
        businessId: business.id,
      },
    });
  } else {
    location = await prisma.location.update({
      where: { id: location.id },
      data: {
        address: 'Uttara, Dhaka',
        deletedAt: null,
      },
    });
  }

  // 5. Default Cashier
  const cashierPublicId = 'CSH-UTT01';
  const cashierEmail = internalCashierEmail(cashierPublicId);
  const cashierPassword = await bcrypt.hash('Cashier@1234', BCRYPT_ROUNDS);

  let cashier = await prisma.user.findUnique({
    where: { publicId: cashierPublicId },
  });

  if (!cashier) {
    cashier = await prisma.user.findUnique({
      where: { email: cashierEmail },
    });
  }

  if (!cashier) {
    await prisma.user.create({
      data: {
        fullName: 'Alex Rivera',
        publicId: cashierPublicId,
        email: cashierEmail,
        password: cashierPassword,
        role: Role.CASHIER,
        status: AccountStatus.ACTIVE,
        businessId: business.id,
        locationId: location.id,
        monthlySalary: 35000,
      },
    });
  } else {
    await prisma.user.update({
      where: { id: cashier.id },
      data: {
        fullName: 'Alex Rivera',
        publicId: cashierPublicId,
        role: Role.CASHIER,
        status: AccountStatus.ACTIVE,
        businessId: business.id,
        locationId: location.id,
        monthlySalary: 35000,
        deletedAt: null,
      },
    });
  }
}

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    try {
      const superAdmin = await this.prisma.user.findFirst({
        where: { role: Role.SUPER_ADMIN, deletedAt: null },
      });

      if (!superAdmin) {
        this.logger.log(
          'No SUPER_ADMIN found in database. Running automated seed...',
        );
        await runDatabaseSeed(this.prisma);
        this.logger.log('Automated database seed completed successfully.');
      }
    } catch (error) {
      this.logger.error(
        `Failed to run automatic database seed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async seed(): Promise<void> {
    await runDatabaseSeed(this.prisma);
  }
}
