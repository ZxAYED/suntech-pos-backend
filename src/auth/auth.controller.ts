import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

const sensitiveThrottle = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register new store admin account',
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
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Registration submitted for approval')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Authenticate user (Admin or Business User/Cashier)',
    description:
      'Login with email/password for Admin or publicId/password for Cashier.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful with JWT tokens',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials or inactive account',
  })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Login successful')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Exchanges a valid refresh token for a fresh access token.',
  })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Access token refreshed')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset OTP',
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
    summary: 'Verify password reset OTP code',
    description: 'Validates 6-digit OTP and returns an ephemeral reset token.',
  })
  @ApiResponse({ status: 200, description: 'OTP verified, returns resetToken' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code' })
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reset code verified')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset account password with reset token',
    description:
      'Sets a new password using the verified reset token from verify-otp.',
  })
  @ApiResponse({ status: 200, description: 'Password successfully updated' })
  @ApiResponse({ status: 400, description: 'Invalid or expired reset token' })
  @Idempotent()
  @Throttle(sensitiveThrottle)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password updated')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
