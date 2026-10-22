import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccountStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { internalCashierEmail } from '../users/user-profile.select';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;

export async function runDatabaseSeed(
  prisma: PrismaClient | PrismaService,
): Promise<void> {
  const logger = new Logger('DatabaseSeed');

  // 1. Purge legacy insecure test credentials if they exist in the database
  try {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { in: ['superadmin@suntech.pos', 'admin@suntechpos.bd'] } },
          { publicId: 'CSH-UTT01' },
        ],
      },
    });
  } catch {
    // If foreign key constraints exist on legacy test accounts, deactivate them
    try {
      await prisma.user.updateMany({
        where: {
          OR: [
            {
              email: { in: ['superadmin@suntech.pos', 'admin@suntechpos.bd'] },
            },
            { publicId: 'CSH-UTT01' },
          ],
        },
        data: {
          status: AccountStatus.SUSPENDED,
          deletedAt: new Date(),
        },
      });
    } catch {
      // Ignore if table doesn't exist yet
    }
  }

  // 2. Super Admin Account (Configured strictly via environment variables)
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const superAdminPasswordRaw = process.env.SUPER_ADMIN_PASSWORD;

  if (superAdminEmail && superAdminPasswordRaw) {
    const superAdminPassword = await bcrypt.hash(
      superAdminPasswordRaw,
      BCRYPT_ROUNDS,
    );

    await prisma.user.upsert({
      where: { email: superAdminEmail },
      update: {
        password: superAdminPassword,
        role: Role.SUPER_ADMIN,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        email: superAdminEmail,
        password: superAdminPassword,
        fullName: process.env.SUPER_ADMIN_NAME?.trim() || 'Super Admin',
        role: Role.SUPER_ADMIN,
        status: AccountStatus.ACTIVE,
        publicId: 'ADM-SUPER',
      },
    });
    logger.log(`Super Admin initialized for email: ${superAdminEmail}`);
  } else {
    logger.warn(
      'SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD environment variables not configured. Skipping Super Admin bootstrap.',
    );
  }

  // 3. Optional Default Store Admin (Configured via environment variables)
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPasswordRaw = process.env.DEFAULT_ADMIN_PASSWORD;

  if (adminEmail && adminPasswordRaw) {
    const adminPassword = await bcrypt.hash(adminPasswordRaw, BCRYPT_ROUNDS);

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        password: adminPassword,
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        email: adminEmail,
        password: adminPassword,
        fullName: process.env.DEFAULT_ADMIN_NAME?.trim() || 'Store Admin',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        publicId: 'ADM-STORE',
      },
    });

    const businessName =
      process.env.DEFAULT_BUSINESS_NAME?.trim() || 'Suntech Retail';
    let business = await prisma.business.findFirst({
      where: { ownerId: admin.id, deletedAt: null },
    });

    if (!business) {
      business = await prisma.business.create({
        data: {
          name: businessName,
          ownerId: admin.id,
        },
      });
    }

    await prisma.user.update({
      where: { id: admin.id },
      data: { businessId: business.id },
    });

    const branchName = process.env.DEFAULT_BRANCH_NAME?.trim() || 'Main Branch';
    let location = await prisma.location.findFirst({
      where: {
        businessId: business.id,
        name: branchName,
      },
    });

    if (!location) {
      location = await prisma.location.create({
        data: {
          name: branchName,
          address: 'Main Store Address',
          businessId: business.id,
        },
      });
    }

    // 4. Optional Cashier (Configured via environment variables)
    const cashierPublicId = process.env.DEFAULT_CASHIER_PUBLIC_ID?.trim();
    const cashierPasswordRaw = process.env.DEFAULT_CASHIER_PASSWORD;

    if (cashierPublicId && cashierPasswordRaw) {
      const cashierEmail = internalCashierEmail(cashierPublicId);
      const cashierPassword = await bcrypt.hash(
        cashierPasswordRaw,
        BCRYPT_ROUNDS,
      );

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
            fullName:
              process.env.DEFAULT_CASHIER_NAME?.trim() || 'Store Cashier',
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
      }
    }
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
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      if (err?.code === 'P2021') {
        this.logger.warn(
          'Database tables do not exist yet. Please run `npx prisma db push` to initialize the database schema before seeding.',
        );
      } else {
        this.logger.error(
          `Failed to run automatic database seed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async seed(): Promise<void> {
    await runDatabaseSeed(this.prisma);
  }
}
