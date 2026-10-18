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
  PasswordResetTokenPayload,
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
const OTP_TTL_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL = '10m';
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

    const passwordMatches = await bcrypt.compare(dto.password, found.password);

    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.assertAccountActive(found.status);
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

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ accepted: true }> {
    const user = await this.findRecoveryUser(dto.loginType, dto.identifier);
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const resetOtpHash = await bcrypt.hash(otp, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetOtpHash,
        otpExpiry: new Date(Date.now() + OTP_TTL_MS),
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

  async verifyOtp(dto: VerifyOtpDto): Promise<{ resetToken: string }> {
    const user = await this.findRecoveryUser(dto.loginType, dto.identifier);

    if (!user.resetOtpHash || !user.otpExpiry) {
      throw new BadRequestException('No reset code is active');
    }

    if (user.otpExpiry.getTime() <= Date.now()) {
      throw new BadRequestException('Reset code has expired');
    }

    const matches = await bcrypt.compare(dto.otp, user.resetOtpHash);

    if (!matches) {
      throw new BadRequestException('Reset code is invalid');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetOtpHash: null, otpExpiry: null },
    });

    const resetToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        purpose: 'password-reset',
      } satisfies PasswordResetTokenPayload,
      { expiresIn: RESET_TOKEN_TTL },
    );

    return { resetToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ updated: true }> {
    const payload = await this.readResetToken(dto.resetToken);
    const password = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('Account not found');
    }

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

    throw new ForbiddenException('Account is not active');
  }

  private buildAccessPayload(user: User): AccessTokenPayload {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
    };

    if (user.role === Role.ADMIN && user.businessId) {
      payload.businessId = user.businessId;
    }

    if (user.role === Role.CASHIER) {
      payload.publicId = user.publicId;
      payload.businessId = user.businessId;
      payload.locationId = user.locationId;
    }

    return payload;
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

  private async readResetToken(
    token: string,
  ): Promise<PasswordResetTokenPayload> {
    try {
      const payload =
        await this.jwtService.verifyAsync<PasswordResetTokenPayload>(token);

      if (payload.purpose !== 'password-reset' || !payload.sub) {
        throw new UnauthorizedException('Reset token is invalid or expired');
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Reset token is invalid or expired');
    }
  }
}
