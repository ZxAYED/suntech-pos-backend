import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdvanceService } from './advance.service';
import { AdvanceSummaryQueryDto } from './dto/advance-summary.query';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { ListAdvancesQueryDto } from './dto/list-advances.query';

@ApiTags('HR - Employee Advances')
@ApiBearerAuth()
@Controller('advances')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdvanceController {
  constructor(private readonly advances: AdvanceService) {}

  @Post()
  @ApiOperation({
    summary: '[ADMIN] Issue off-register employee salary advance',
    description:
      'Creates an off-register advance for cashier. (In-shift register drawer cash advances must use /shifts/advances). Enforces atomic salary cap check: total pending advances for current payroll month cannot exceed employee monthlySalary. Accessible by ADMIN only.',
  })
  @ApiResponse({ status: 201, description: 'Advance recorded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires ADMIN role',
  })
  @ApiResponse({
    status: 400,
    description: 'Advance amount exceeds remaining monthly salary limit or cashier has no salary configured',
  })
  @Roles(Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Advance recorded')
  create(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.advances.create(actor, dto);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List employee advances with filters',
    description:
      'Cashiers see only their own advances; Admins see business-wide advances filterable by branch location, cashier, month, and year. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 200, description: 'Advances loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Advances loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListAdvancesQueryDto,
  ) {
    return this.advances.list(actor, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get monthly advance summary',
    description:
      'Calculates total approved and deducted advance amounts for a given month and year. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 200, description: 'Advance summary loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
  @ResponseMessage('Advance summary loaded')
  summary(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: AdvanceSummaryQueryDto,
  ) {
    return this.advances.summary(actor, query);
  }

  @Delete(':id')
  @ApiOperation({
    summary: '[ADMIN] Cancel pending advance',
    description:
      'Admin cancels a pending advance that has not yet been deducted in payroll. Requires ADMIN role.',
  })
  @ApiParam({ name: 'id', description: 'Advance ID' })
  @ApiResponse({ status: 200, description: 'Advance removed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - requires ADMIN role' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete already deducted advance',
  })
  @ApiResponse({ status: 404, description: 'Advance not found' })
  @Roles(Role.ADMIN)
  @ResponseMessage('Advance removed')
  remove(@CurrentUser() actor: AccessTokenPayload, @Param('id') id: string) {
    return this.advances.remove(actor, id);
  }
}
