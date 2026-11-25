import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { AuthService } from './auth.service';
import { ForceLogoutDto } from './dto/force-logout.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { extractCleanJwt } from './strategies/jwt.strategy';

const sensitiveThrottle = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: '[PUBLIC] Register new store admin account',
    description:
      'Submits registration for new Store Admin. Account remains PENDING_APPROVAL until reviewed by Super Admin.',
  })
  @ApiResponse({
    status: 201,
    description: 'Registration submitted successfully',
  })
  @ApiResponse({
    status: 409,
    description: 'Email or phone number already in use',
  })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Registration submitted for approval')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: '[PUBLIC] Authenticate user (Admin or Business User/Cashier)',
    description:
      'Login with email/password for Admin or publicId/password for Cashier. Sets refreshToken in an HttpOnly secure cookie and returns accessToken and user details in the response body.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful with accessToken and user profile',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials or inactive account',
  })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Login successful')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);

    this.setRefreshTokenCookie(response, result.refreshToken);
    this.setAccessTokenCookie(response, result.accessToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @ApiOperation({
    summary: '[PUBLIC] Refresh access token',
    description:
      'Exchanges a valid refresh token (from HttpOnly cookie or request body) for a fresh access token.',
  })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Access token refreshed')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.refreshToken || dto?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const result = await this.authService.refresh(refreshToken);
    this.setAccessTokenCookie(response, result.accessToken);

    return result;
  }

  @Post('logout')
  @ApiOperation({
    summary: '[PUBLIC] Logout user',
    description:
      'Clears authentication cookies (refreshToken, accessToken) and invalidates active cashier session on server.',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Logged out successfully')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const isProduction = process.env.NODE_ENV === 'production';
    const accessToken = extractCleanJwt(request);
    const refreshToken = request.cookies?.refreshToken;

    response.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/api/v1/auth',
    });
    response.clearCookie('accessToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
    });

    return this.authService.logout({
      accessToken: accessToken || undefined,
      refreshToken: refreshToken || undefined,
    });
  }

  @Post('force-logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: '[ADMIN] Force logout an active cashier',
    description:
      'Terminates an active cashier session immediately within the store admin business.',
  })
  @ApiResponse({ status: 200, description: 'Cashier session terminated' })
  @ApiResponse({
    status: 403,
    description: 'Cashier does not belong to admin business',
  })
  @ApiResponse({ status: 404, description: 'Cashier account not found' })
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cashier force-logged out')
  forceLogout(
    @CurrentUser() admin: AccessTokenPayload,
    @Body() dto: ForceLogoutDto,
  ) {
    return this.authService.forceLogout(admin, dto);
  }

  private setRefreshTokenCookie(response: Response, token: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    response.cookie('refreshToken', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/api/v1/auth',
      maxAge: thirtyDaysMs,
    });
  }

  private setAccessTokenCookie(response: Response, token: string): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    response.cookie('accessToken', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      path: '/',
      maxAge: sevenDaysMs,
    });
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: '[PUBLIC] Request password reset OTP',
    description:
      'Sends a 6-digit verification code to the registered email address.',
  })
  @ApiResponse({
    status: 200,
    description: 'Reset code dispatched if account found',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid identifier or cashier without recovery email configured',
  })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset code sent')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: '[PUBLIC] Verify password reset OTP code',
    description:
      'Validates 6-digit OTP code against the registered admin account.',
  })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code' })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reset code verified')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: '[PUBLIC] Reset account password using OTP',
    description:
      'Sets a new password using email, 6-digit OTP, and newPassword.',
  })
  @ApiResponse({ status: 200, description: 'Password successfully updated' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code' })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password updated')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
