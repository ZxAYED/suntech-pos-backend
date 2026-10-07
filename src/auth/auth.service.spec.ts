import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { EmailTemplateService } from '../identity/email-template.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginType } from './dto/login-type.enum';

jest.mock('@nestjs/jwt', () => ({
  JwtService: class JwtService {},
}));

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AuthService', () => {
  const create = jest.fn();
  const findFirst = jest.fn();
  const prisma = {
    user: { create, findFirst },
  } as unknown as PrismaService;
  const signAsync = jest.fn().mockResolvedValue('token');
  const jwtService = {
    signAsync,
  } as unknown as ConstructorParameters<typeof AuthService>[1];
  const emailTemplateService = {
    sendPasswordReset: jest.fn(),
    renderPasswordReset: jest.fn().mockReturnValue('<html></html>'),
  } as unknown as EmailTemplateService;
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '30d',
      };
      const value = values[key];
      if (!value) {
        throw new Error(key);
      }
      return value;
    }),
  } as unknown as ConstructorParameters<typeof AuthService>[3];
  const mailService = { deliver: jest.fn() } as unknown as MailService;
  const service = new AuthService(
    prisma,
    jwtService,
    emailTemplateService,
    configService,
    mailService,
  );

  beforeEach(() => {
    create.mockReset();
    findFirst.mockReset();
    signAsync.mockClear();
  });

  it('registers a pending admin and does not mint a public id', async () => {
    create.mockResolvedValue({
      id: 'user-1',
      publicId: null,
      fullName: 'Amina Rahman',
      email: 'amina@shop.test',
      phoneNumber: null,
      role: Role.ADMIN,
      status: AccountStatus.PENDING_APPROVAL,
      businessId: null,
      locationId: null,
    });

    const result = await service.register({
      fullName: 'Amina Rahman',
      email: 'amina@shop.test',
      password: 'password123',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: Role.ADMIN,
          status: AccountStatus.PENDING_APPROVAL,
          email: 'amina@shop.test',
        }) as object,
      }),
    );
    const data = (create.mock.calls[0] as [{ data: { publicId?: string } }])[0]
      .data;
    expect(data.publicId).toBeUndefined();
    expect(result.publicId).toBeNull();
    expect(result.status).toBe(AccountStatus.PENDING_APPROVAL);
  });

  it('rejects a cashier who signs in through the admin login', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      password: 'hashed-password',
      email: 'cashier@shop.test',
    });

    await expect(
      service.login({
        loginType: LoginType.ADMIN,
        email: 'cashier@shop.test',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.login({
        loginType: LoginType.ADMIN,
        email: 'cashier@shop.test',
        password: 'password123',
      }),
    ).rejects.toThrow('Invalid login mode');
  });

  it('rejects an admin who signs in with a public id', async () => {
    findFirst.mockResolvedValue({
      id: 'admin-1',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      password: 'hashed-password',
      publicId: 'ADM-8X9B2',
    });

    await expect(
      service.login({
        loginType: LoginType.BUSINESS_USER,
        publicId: 'ADM-8X9B2',
        password: 'password123',
      }),
    ).rejects.toThrow('Invalid login mode');
  });

  it('issues a cashier token that carries the tenant ids', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      publicId: 'CSH-8X9B2',
      fullName: 'Rafi',
      email: 'rafi@shop.test',
      phoneNumber: null,
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      businessId: 'biz-1',
      locationId: 'loc-1',
      password: 'hashed-password',
    });

    await service.login({
      loginType: LoginType.BUSINESS_USER,
      publicId: 'CSH-8X9B2',
      password: 'password123',
    });

    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'cashier-1',
        role: Role.CASHIER,
        publicId: 'CSH-8X9B2',
        businessId: 'biz-1',
        locationId: 'loc-1',
      }),
    );
  });

  it('returns 401 when the admin email does not exist', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.login({
        loginType: LoginType.ADMIN,
        email: 'missing@shop.test',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
