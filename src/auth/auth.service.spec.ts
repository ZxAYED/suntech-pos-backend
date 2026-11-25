import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
  const update = jest.fn();
  const updateMany = jest.fn();
  const findFirst = jest.fn();
  const locationFindFirst = jest.fn();
  const businessFindFirst = jest.fn();
  const prisma = {
    user: { create, update, updateMany, findFirst },
    location: { findFirst: locationFindFirst },
    business: { findFirst: businessFindFirst },
  } as unknown as PrismaService;
  const signAsync = jest.fn().mockResolvedValue('token');
  const verifyAsync = jest.fn();
  const jwtService = {
    signAsync,
    verifyAsync,
  } as unknown as ConstructorParameters<typeof AuthService>[1];
  const emailTemplateService = {
    sendPasswordReset: jest.fn(),
    renderPasswordReset: jest.fn().mockReturnValue('<html></html>'),
  } as unknown as EmailTemplateService;
  const configService = {
    get: jest.fn((key: string) =>
      key === 'JWT_RESET_SECRET' ? 'reset-secret' : undefined,
    ),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_REFRESH_TTL: '30d',
        JWT_RESET_SECRET: 'reset-secret',
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
    update.mockReset();
    updateMany.mockReset();
    findFirst.mockReset();
    locationFindFirst.mockReset();
    businessFindFirst.mockReset();
    signAsync.mockClear();
    verifyAsync.mockReset();

    updateMany.mockResolvedValue({ count: 1 });
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

  it('issues a cashier token that carries the session ID and tenant ids', async () => {
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
    locationFindFirst.mockResolvedValue({
      id: 'loc-1',
      businessId: 'biz-1',
      deletedAt: null,
    });

    await service.login({
      loginType: LoginType.BUSINESS_USER,
      publicId: 'CSH-8X9B2',
      password: 'password123',
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cashier-1',
        isLoggedIn: false,
        deletedAt: null,
      },
      data: expect.objectContaining({
        isLoggedIn: true,
        sessionId: expect.any(String),
        lastLoginAt: expect.any(Date),
      }),
    });

    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'cashier-1',
        role: Role.CASHIER,
        publicId: 'CSH-8X9B2',
        businessId: 'biz-1',
        locationId: 'loc-1',
        sessionId: expect.any(String),
      }),
    );
  });

  it('rejects simultaneous cashier login when session is already claimed', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      publicId: 'CSH-8X9B2',
      fullName: 'Rafi',
      email: 'rafi@shop.test',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      businessId: 'biz-1',
      locationId: 'loc-1',
      password: 'hashed-password',
    });
    locationFindFirst.mockResolvedValue({
      id: 'loc-1',
      businessId: 'biz-1',
      deletedAt: null,
    });
    // Atomic claim fails (count = 0)
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.login({
        loginType: LoginType.BUSINESS_USER,
        publicId: 'CSH-8X9B2',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cleans up only claimed session if token signing fails during login', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      publicId: 'CSH-8X9B2',
      fullName: 'Rafi',
      email: 'rafi@shop.test',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      businessId: 'biz-1',
      locationId: 'loc-1',
      password: 'hashed-password',
    });
    locationFindFirst.mockResolvedValue({
      id: 'loc-1',
      businessId: 'biz-1',
      deletedAt: null,
    });
    signAsync.mockRejectedValueOnce(new Error('Signing failure'));

    await expect(
      service.login({
        loginType: LoginType.BUSINESS_USER,
        publicId: 'CSH-8X9B2',
        password: 'password123',
      }),
    ).rejects.toThrow('Signing failure');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cashier-1',
        sessionId: expect.any(String),
      },
      data: {
        isLoggedIn: false,
        sessionId: null,
      },
    });
  });

  it('does not lock admins to a single session', async () => {
    findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@shop.test',
      role: Role.ADMIN,
      status: AccountStatus.ACTIVE,
      password: 'hashed-password',
      businessId: 'biz-1',
      ownedBusinesses: [{ id: 'biz-1', locations: [] }],
    });

    await service.login({
      loginType: LoginType.ADMIN,
      email: 'admin@shop.test',
      password: 'password123',
    });

    expect(updateMany).not.toHaveBeenCalled();
    expect(signAsync).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sessionId: expect.anything(),
      }),
    );
  });

  it('refreshes cashier token when session ID matches active DB session', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'cashier-1',
      purpose: 'refresh',
      sessionId: 'sess-active',
    });
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      isLoggedIn: true,
      sessionId: 'sess-active',
      businessId: 'biz-1',
      locationId: 'loc-1',
    });
    locationFindFirst.mockResolvedValue({
      id: 'loc-1',
      businessId: 'biz-1',
      deletedAt: null,
    });

    const result = await service.refresh('valid-refresh-token');
    expect(result.accessToken).toBe('token');
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'cashier-1',
        sessionId: 'sess-active',
      }),
    );
  });

  it('rejects cashier refresh when session has been logged out or force-logged out', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'cashier-1',
      purpose: 'refresh',
      sessionId: 'sess-old',
    });
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      isLoggedIn: false,
      sessionId: null,
      businessId: 'biz-1',
      locationId: 'loc-1',
    });

    await expect(service.refresh('old-refresh-token')).rejects.toThrow(
      'Refresh token is invalid or session has ended',
    );
  });

  it('rejects cashier refresh if businessId or locationId is missing in DB', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'cashier-1',
      purpose: 'refresh',
      sessionId: 'sess-1',
    });
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
      isLoggedIn: true,
      sessionId: 'sess-1',
      businessId: 'biz-1',
      locationId: null,
    });

    await expect(service.refresh('some-refresh-token')).rejects.toThrow(
      'Cashier account must be assigned to an active business and branch location',
    );
  });

  it('clears cashier session on logout when token identifies current session', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'cashier-1',
      sessionId: 'sess-123',
    });

    const result = await service.logout({
      accessToken: 'access-token',
    });

    expect(result).toEqual({ loggedOut: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cashier-1',
        sessionId: 'sess-123',
      },
      data: expect.objectContaining({
        isLoggedIn: false,
        sessionId: null,
        lastLogoutAt: expect.any(Date),
      }),
    });
  });

  it('admin force-logout terminates cashier session within admin business', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-1',
    });

    const admin = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
      businessIds: ['biz-1'],
    };

    const result = await service.forceLogout(admin as any, {
      cashierId: 'cashier-1',
    });

    expect(result).toEqual({ loggedOut: true, cashierId: 'cashier-1' });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'cashier-1',
        role: Role.CASHIER,
      },
      data: expect.objectContaining({
        isLoggedIn: false,
        sessionId: null,
        lastLogoutAt: expect.any(Date),
      }),
    });
  });

  it('admin force-logout rejects target cashier from another business', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      role: Role.CASHIER,
      businessId: 'biz-other',
    });
    businessFindFirst.mockResolvedValue(null);

    const admin = {
      sub: 'admin-1',
      role: Role.ADMIN,
      businessId: 'biz-1',
      businessIds: ['biz-1'],
    };

    await expect(
      service.forceLogout(admin as any, { cashierId: 'cashier-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

  it('rejects forgotPassword for cashier with @cashiers.suntech.internal email', async () => {
    findFirst.mockResolvedValue({
      id: 'cashier-1',
      publicId: 'CSH-001',
      fullName: 'Alex Rivera',
      email: 'csh-001@cashiers.suntech.internal',
      role: Role.CASHIER,
      status: AccountStatus.ACTIVE,
    });

    await expect(
      service.forgotPassword({
        loginType: LoginType.BUSINESS_USER,
        identifier: 'CSH-001',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not reveal whether a password-recovery account exists', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.forgotPassword({
        loginType: LoginType.ADMIN,
        identifier: 'missing@example.com',
      }),
    ).resolves.toEqual({ accepted: true });
  });

  it('returns a short-lived password reset token after OTP verification', async () => {
    findFirst.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: Role.ADMIN,
      resetOtpHash: 'hashed-otp',
      otpExpiry: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyOtp({
        loginType: LoginType.ADMIN,
        identifier: 'admin@example.com',
        otp: '123456',
      }),
    ).resolves.toEqual({ resetToken: 'token' });
    expect(signAsync).toHaveBeenCalledWith(
      { sub: 'admin-1', purpose: 'password-reset' },
      { secret: 'reset-secret', expiresIn: '10m' },
    );
  });

  it('resets a password only through a valid reset token', async () => {
    verifyAsync.mockResolvedValue({
      sub: 'admin-1',
      purpose: 'password-reset',
    });
    findFirst.mockResolvedValue({
      id: 'admin-1',
      resetOtpHash: 'hashed-otp',
      otpExpiry: new Date(Date.now() + 60_000),
    });
    update.mockResolvedValue({ id: 'admin-1' });

    await expect(
      service.resetPassword({
        resetToken: 'valid-reset-token',
        newPassword: 'NewPassword123',
      }),
    ).resolves.toEqual({ updated: true });
    expect(verifyAsync).toHaveBeenCalledWith('valid-reset-token', {
      secret: 'reset-secret',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: {
        password: 'hashed-password',
        resetOtpHash: null,
        otpExpiry: null,
      },
    });
  });
});
