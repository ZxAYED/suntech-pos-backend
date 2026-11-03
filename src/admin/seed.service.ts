import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AccountStatus, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 10;

export async function runDatabaseSeed(
  prisma: PrismaClient | PrismaService,
): Promise<void> {
  const logger = new Logger('DatabaseSeed');

  // 1. Super Admin Account (Configured via environment variables)
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const superAdminPasswordRaw = process.env.SUPER_ADMIN_PASSWORD;
  if (!superAdminEmail || !superAdminPasswordRaw?.trim()) {
    throw new Error(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required to run the bootstrap seed',
    );
  }

  if (superAdminEmail && superAdminPasswordRaw) {
    const superAdminPassword = await bcrypt.hash(
      superAdminPasswordRaw,
      BCRYPT_ROUNDS,
    );

    // Ensure publicId 'ADM-SUPER' does not collide with a different user on creation
    let defaultSuperAdminPublicId: string | undefined = 'ADM-SUPER';
    const existingWithPublicId = await prisma.user.findFirst({
      where: {
        publicId: defaultSuperAdminPublicId,
        email: { not: superAdminEmail },
      },
      select: { id: true },
    });
    if (existingWithPublicId) {
      defaultSuperAdminPublicId = undefined;
    }

    const superAdmin = await prisma.user.upsert({
      where: { email: superAdminEmail },
      // Existing identity/password/status are owned by the live auth flows.
      update: {},
      create: {
        email: superAdminEmail,
        password: superAdminPassword,
        fullName: process.env.SUPER_ADMIN_NAME?.trim() || 'Super Admin',
        role: Role.SUPER_ADMIN,
        status: AccountStatus.ACTIVE,
        ...(defaultSuperAdminPublicId
          ? { publicId: defaultSuperAdminPublicId }
          : {}),
      },
    });

    if (superAdmin.role !== Role.SUPER_ADMIN) {
      throw new Error('Configured bootstrap email belongs to a non-SUPER_ADMIN user');
    }
    logger.log(`Super Admin bootstrap checked for email: ${superAdminEmail}`);
  }


  // 2. Store Admin Account (Optional, configured via environment variables)
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPasswordRaw = process.env.DEFAULT_ADMIN_PASSWORD;
  if (Boolean(adminEmail) !== Boolean(adminPasswordRaw?.trim())) {
    throw new Error(
      'DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD must both be provided when bootstrapping a store admin',
    );
  }
  if (adminEmail && adminEmail === superAdminEmail) {
    throw new Error('DEFAULT_ADMIN_EMAIL must differ from SUPER_ADMIN_EMAIL');
  }

  if (adminEmail && adminPasswordRaw && adminEmail !== superAdminEmail) {
    const adminPassword = await bcrypt.hash(adminPasswordRaw, BCRYPT_ROUNDS);

    let defaultAdminPublicId: string | undefined = 'ADM-STORE';
    const existingAdminWithPublicId = await prisma.user.findFirst({
      where: {
        publicId: defaultAdminPublicId,
        email: { not: adminEmail },
      },
      select: { id: true },
    });
    if (existingAdminWithPublicId) {
      defaultAdminPublicId = undefined;
    }

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        password: adminPassword,
        fullName: process.env.DEFAULT_ADMIN_NAME?.trim() || 'Store Admin',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        ...(defaultAdminPublicId ? { publicId: defaultAdminPublicId } : {}),
      },
    });

    if (admin.role !== Role.ADMIN) {
      throw new Error('Configured bootstrap email belongs to a non-ADMIN user');
    }
    logger.log(`Store Admin bootstrap checked for email: ${adminEmail}`);
  }
}

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Seeding is an explicit one-time deployment action, not a side-effect of
    // every API startup. Never silently reset credentials or revive suspended users.
    if (process.env.NODE_ENV === 'test' || process.env.RUN_BOOTSTRAP_SEED !== 'true') {
      return;
    }
    await runDatabaseSeed(this.prisma);
  }

  async seed(): Promise<void> {
    await runDatabaseSeed(this.prisma);
  }
}
