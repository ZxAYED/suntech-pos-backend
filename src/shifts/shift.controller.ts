import {
  Body,
  Controller,
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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role, ShiftStatus } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AccessTokenPayload } from '../common/types/access-token-payload';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ListShiftsQueryDto } from './dto/list-shifts.query';
import { OpenShiftDto } from './dto/open-shift.dto';
import { ShiftService } from './shift.service';

@ApiTags('Shift Sessions & Cash Register')
@ApiBearerAuth()
@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CASHIER, Role.ADMIN)
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Post('open')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Open a new register shift',
    description:
      'Opens a register shift with starting cash float. If a shift was left open on a previous calendar day (Dhaka timezone), set autoClosePrevious=true to reconcile and auto-close it. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 201, description: 'Shift opened successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @ApiResponse({
    status: 400,
    description:
      'Previous shift was left open on a previous day and requires auto-close confirmation, or an active shift already exists today',
  })
  @ApiResponse({ status: 409, description: 'Conflict opening shift' })
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Shift opened')
  open(@CurrentUser() actor: AccessTokenPayload, @Body() dto: OpenShiftDto) {
    return this.shifts.open(actor, dto);
  }

  @Get('active')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Get active open shift session',
    description:
      'Retrieves current open shift details with real-time drawer metrics and advance subtractions. Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 200, description: 'Active shift loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @ApiResponse({ status: 404, description: 'No active open shift found' })
  @Roles(Role.CASHIER, Role.ADMIN)
  @ResponseMessage('Active shift loaded')
  getActive(@CurrentUser() actor: AccessTokenPayload) {
    return this.shifts.getActive(actor);
  }

  @Post('close')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Close current active shift',
    description:
      'Reconciles counted drawer cash with expected cash (cash float + COD sales - COD refunds - advances). Accessible by CASHIER and ADMIN.',
  })
  @ApiResponse({ status: 200, description: 'Shift closed successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @ApiResponse({ status: 404, description: 'No active shift found' })
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Shift closed')
  closeActive(
    @CurrentUser() actor: AccessTokenPayload,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(actor, undefined, dto);
  }

  @Post(':id/close')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Close specific shift by ID',
    description:
      'Admin or shift owner closes a specific shift session by ID. Accessible by CASHIER and ADMIN.',
  })
  @ApiParam({ name: 'id', description: 'Shift ID' })
  @ApiResponse({ status: 200, description: 'Shift closed successfully' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @ApiResponse({ status: 404, description: 'Shift not found' })
  @Roles(Role.CASHIER, Role.ADMIN)
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Shift closed')
  close(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(actor, id, dto);
  }

  @Get()
  @ApiOperation({
    summary: '[ADMIN, CASHIER] List shift history with filters',
    description:
      'Paginated shift session audit list. Cashier is restricted to own shifts; Admin can filter by location. Accessible by CASHIER and ADMIN.',
  })
  @ApiQuery({
    name: 'locationId',
    required: false,
    description: 'Filter shifts by location ID',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ShiftStatus,
    enumName: 'ShiftStatus',
    description: 'Filter by shift status',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size limit',
    example: 10,
  })
  @ApiQuery({
    name: 'businessId',
    required: false,
    description:
      'Optional business UUID for Admin; Cashier is locked to assigned business from token',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({ status: 200, description: 'Shifts loaded' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires CASHIER or ADMIN role',
  })
  @Roles(Role.CASHIER, Role.ADMIN)
  @ResponseMessage('Shifts loaded')
  list(
    @CurrentUser() actor: AccessTokenPayload,
    @Query() query: ListShiftsQueryDto,
  ) {
    return this.shifts.list(actor, query);
  }
}
