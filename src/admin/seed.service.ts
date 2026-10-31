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
  const superAdminEmail = (
    process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL
  )
    ?.trim()
    .toLowerCase();
  const superAdminPasswordRaw =
    process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

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
      update: {
        password: superAdminPassword,
        role: Role.SUPER_ADMIN,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        email: superAdminEmail,
        password: superAdminPassword,
        fullName:
          process.env.SUPER_ADMIN_NAME?.trim() ||
          process.env.ADMIN_NAME?.trim() ||
          'Super Admin',
        role: Role.SUPER_ADMIN,
        status: AccountStatus.ACTIVE,
        ...(defaultSuperAdminPublicId
          ? { publicId: defaultSuperAdminPublicId }
          : {}),
      },
    });

    logger.log(
      `Super Admin bootstrapped successfully for email: ${superAdminEmail} (Role: ${superAdmin.role})`,
    );
  } else {
    logger.warn(
      'SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD environment variables not configured. Skipping Super Admin bootstrap.',
    );
  }

  // 2. Store Admin Account (Optional, configured via environment variables)
  const adminEmail = (
    process.env.DEFAULT_ADMIN_EMAIL ||
    (process.env.ADMIN_EMAIL !== superAdminEmail
      ? process.env.ADMIN_EMAIL
      : undefined)
  )
    ?.trim()
    .toLowerCase();
  const adminPasswordRaw =
    process.env.DEFAULT_ADMIN_PASSWORD ||
    (process.env.ADMIN_EMAIL !== superAdminEmail
      ? process.env.ADMIN_PASSWORD
      : undefined);

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
      update: {
        password: adminPassword,
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        email: adminEmail,
        password: adminPassword,
        fullName:
          process.env.DEFAULT_ADMIN_NAME?.trim() ||
          process.env.ADMIN_NAME?.trim() ||
          'Store Admin',
        role: Role.ADMIN,
        status: AccountStatus.ACTIVE,
        ...(defaultAdminPublicId ? { publicId: defaultAdminPublicId } : {}),
      },
    });

    logger.log(
      `Store Admin bootstrapped successfully for email: ${adminEmail} (Role: ${admin.role})`,
    );
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
      await runDatabaseSeed(this.prisma);
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
