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
    summary: 'Request / issue employee salary advance',
    description:
      'Creates an advance request for cashier. Enforces atomic salary cap check: total pending advances for current payroll month cannot exceed employee monthlySalary.',
  })
  @ApiResponse({ status: 201, description: 'Advance recorded' })
  @ApiResponse({
    status: 400,
    description: 'Advance amount exceeds remaining monthly salary limit',
  })
  @Roles(Role.ADMIN, Role.CASHIER)
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
    summary: 'List employee advances with filters',
    description:
      'Cashiers see only their own advances; Admins see business-wide advances filterable by branch location, cashier, month, and year.',
  })
  @ApiResponse({ status: 200, description: 'Advances loaded' })
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
    summary: 'Get monthly advance summary',
    description:
      'Calculates total approved and deducted advance amounts for a given month and year.',
  })
  @ApiResponse({ status: 200, description: 'Advance summary loaded' })
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
    summary: 'Cancel pending advance',
    description:
      'Admin cancels a pending advance that has not yet been deducted in payroll.',
  })
  @ApiResponse({ status: 200, description: 'Advance removed' })
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
