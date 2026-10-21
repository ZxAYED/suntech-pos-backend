import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AccountStatus, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../common/types/access-token-payload';
import { isUniqueConstraintError } from '../common/prisma/is-unique-constraint.error';
import {
  PublicUser,
  userPublicSelect,
} from '../common/prisma/user-public.select';
import { presentEmail } from '../users/user-profile.select';

type PresentedPublicUser = Omit<PublicUser, 'email'> & {
  email: string | null;
};
import { EmailTemplateService } from '../identity/email-template.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LoginType } from './dto/login-type.enum';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

const BCRYPT_ROUNDS = 10;
const INVALID_LOGIN_MODE = 'Invalid login mode';
const INVALID_CREDENTIALS = 'Invalid credentials';

const adminRoles: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      return await this.prisma.user.create({
        data: {
          fullName: dto.fullName.trim(),
          email: dto.email.trim().toLowerCase(),
          phoneNumber: dto.phoneNumber?.trim() || null,
          password,
          role: Role.ADMIN,
          status: AccountStatus.PENDING_APPROVAL,
        },
        select: userPublicSelect,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'An account with that email or phone number already exists',
        );
      }

      throw error;
    }
  }

  async login(dto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: PresentedPublicUser;
  }> {
    const found =
      dto.loginType === LoginType.ADMIN
        ? await this.findByEmail(dto.email ?? '')
        : await this.findByPublicId(dto.publicId ?? '');

    this.assertLoginMode(dto.loginType, found.role);
    this.assertAccountActive(found.status);

    const passwordMatches = await bcrypt.compare(dto.password, found.password);

    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const user = await this.attachOwnedBusiness(found);

    if (user.role === Role.CASHIER) {
      if (
        !user.businessId ||
        !user.locationId ||
        typeof user.businessId !== 'string' ||
        typeof user.locationId !== 'string'
      ) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }

      const location = await this.prisma.location.findFirst({
        where: {
          id: user.locationId,
          businessId: user.businessId,
          deletedAt: null,
        },
      });

      if (!location) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }
    }

    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.signRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: this.toPublicUser(user),
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string }> {
    const payload = await this.readRefreshToken(refreshToken);
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    this.assertAccountActive(user.status);
    const sessionUser = await this.attachOwnedBusiness(user);

    if (sessionUser.role === Role.CASHIER) {
      if (
        !sessionUser.businessId ||
        !sessionUser.locationId ||
        typeof sessionUser.businessId !== 'string' ||
        typeof sessionUser.locationId !== 'string'
      ) {
        throw new ForbiddenException(
          'Cashier account must be assigned to an active business and branch location',
        );
      }
    }

    return { accessToken: await this.signAccessToken(sessionUser) };
  }

  async signAccessToken(user: User): Promise<string> {
    return this.jwtService.signAsync(this.buildAccessPayload(user));
  }

  private getOtpTtlMs(): number {
    const rawMinutes = this.configService.get<string>('OTP_TTL_MINUTES', '15');
    const minutes = Number(rawMinutes);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 15) * 60 * 1000;
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ accepted: true }> {
    const identifier = (dto.email || dto.identifier || '').trim();
    if (!identifier) {
      throw new BadRequestException('Email address is required');
    }

    const user = await this.findRecoveryUser(
      dto.loginType ?? LoginType.ADMIN,
      identifier,
    );

    if (
      user.role === Role.CASHIER ||
      user.email.endsWith('@cashiers.suntech.internal')
    ) {
      throw new BadRequestException(
        'No recovery email is configured for this cashier account. Please ask your Store Admin to reset your password.',
      );
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const resetOtpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtpHash,
        otpExpiry: new Date(Date.now() + this.getOtpTtlMs()),
      },
    });

    this.emailTemplateService.sendPasswordReset({
      fullName: user.fullName,
      email: user.email,
      otp,
    });

    await this.mailService.deliver({
      to: user.email,
      subject: 'Reset your SunTech password',
      html: this.emailTemplateService.renderPasswordReset({
        fullName: user.fullName,
        email: user.email,
        otp,
      }),
    });

    return { accepted: true };
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ verified: true }> {
    const identifier = (dto.email || dto.identifier || '').trim();
    if (!identifier) {
      throw new BadRequestException('Email address is required');
    }

    const user = await this.findRecoveryUser(
      dto.loginType ?? LoginType.ADMIN,
      identifier,
    );

    if (!user.resetOtpHash || !user.otpExpiry) {
      throw new BadRequestException('No reset code is active');
    }

    if (user.otpExpiry.getTime() <= Date.now()) {
      throw new BadRequestException('Reset code has expired');
    }

    const matches = await bcrypt.compare(dto.otp.trim(), user.resetOtpHash);

    if (!matches) {
      throw new BadRequestException('Reset code is invalid');
    }

    return { verified: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ updated: true }> {
    const identifier = (dto.email || dto.identifier || '').trim();
    if (!identifier) {
      throw new BadRequestException('Email address is required');
    }

    const user = await this.findRecoveryUser(LoginType.ADMIN, identifier);

    if (!user.resetOtpHash || !user.otpExpiry) {
      throw new BadRequestException('No reset code is active for this account');
    }

    if (user.otpExpiry.getTime() <= Date.now()) {
      throw new BadRequestException('Reset code has expired');
    }

    const matches = await bcrypt.compare(dto.otp.trim(), user.resetOtpHash);

    if (!matches) {
      throw new BadRequestException('Reset code is invalid');
    }

    const password = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password,
        resetOtpHash: null,
        otpExpiry: null,
      },
    });

    return { updated: true };
  }

  private async findByEmail(email: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return user;
  }

  private async findByPublicId(publicId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: {
        publicId: publicId.trim().toUpperCase(),
        deletedAt: null,
      },
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return user;
  }

  private async findRecoveryUser(
    loginType: LoginType,
    identifier: string,
  ): Promise<User> {
    const user =
      loginType === LoginType.ADMIN
        ? await this.prisma.user.findFirst({
            where: {
              email: identifier.trim().toLowerCase(),
              deletedAt: null,
            },
          })
        : await this.prisma.user.findFirst({
            where: {
              publicId: identifier.trim().toUpperCase(),
              deletedAt: null,
            },
          });

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    this.assertLoginMode(loginType, user.role);
    return user;
  }

  private assertLoginMode(loginType: LoginType, role: Role): void {
    const allowed =
      loginType === LoginType.ADMIN
        ? adminRoles.includes(role)
        : role === Role.CASHIER;

    if (!allowed) {
      throw new ForbiddenException(INVALID_LOGIN_MODE);
    }
  }

  private assertAccountActive(status: AccountStatus): void {
    if (status === AccountStatus.ACTIVE) {
      return;
    }

    if (status === AccountStatus.PENDING_APPROVAL) {
      throw new ForbiddenException('Account is pending approval');
    }

    if (status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Account is suspended. Please contact administrator.',
      );
    }

    if (status === AccountStatus.REJECTED) {
      throw new ForbiddenException('Account application was rejected');
    }

    throw new ForbiddenException('Account is not active');
  }

  private buildAccessPayload(user: User): AccessTokenPayload {
    return {
      sub: user.id,
      role: user.role,
      publicId: user.publicId,
      businessId: user.businessId,
      locationId: user.locationId,
    };
  }

  private toPublicUser(user: User): PresentedPublicUser {
    return {
      id: user.id,
      publicId: user.publicId,
      fullName: user.fullName,
      email: presentEmail(user.email),
      phoneNumber: user.phoneNumber,
      role: user.role,
      status: user.status,
      businessId: user.businessId,
      locationId: user.locationId,
      profileImageUrl: user.profileImageUrl,
    };
  }

  private async attachOwnedBusiness(user: User): Promise<User> {
    if (user.role !== Role.ADMIN || user.businessId) {
      return user;
    }

    const owned = await this.prisma.business.findUnique({
      where: { ownerId: user.id },
    });

    if (!owned) {
      return user;
    }

    return this.prisma.user.update({
      where: { id: user.id },
      data: { businessId: owned.id },
    });
  }

  private async signRefreshToken(userId: string): Promise<string> {
    const expiresIn = this.configService.getOrThrow<string>('JWT_REFRESH_TTL');

    return this.jwtService.signAsync(
      { sub: userId, purpose: 'refresh' } satisfies RefreshTokenPayload,
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: expiresIn as JwtSignOptions['expiresIn'],
      },
    );
  }

  private async readRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        token,
        {
          secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        },
      );

      if (payload.purpose !== 'refresh' || !payload.sub) {
        throw new UnauthorizedException('Refresh token is invalid or expired');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
  }
}
