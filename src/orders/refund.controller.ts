import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
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
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundService } from './refund.service';
import type { Request } from 'express';
import { requireAtomicReceipt } from '../common/interceptors/atomic-idempotency';

@ApiTags('Orders - Refunds')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.CASHIER)
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  @Post(':id/refunds')
  @ApiOperation({
    summary: '[ADMIN, CASHIER] Process partial or full order refund',
    description:
      'Refunds specified order items. If order becomes fully refunded, marks Order.status = REFUNDED. For COD orders associated with a shift, decrements drawer cashCollected. Accessible by both ADMIN and CASHIER.',
  })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 201, description: 'Refund completed' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - requires ADMIN or CASHIER role',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid refund quantities or order not refundable',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @Idempotent({ atomic: true })
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Refund completed')
  async create(
    @CurrentUser() actor: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
    @Req() request: Request,
  ) {
    const receipt = requireAtomicReceipt(request);
    receipt.response = await this.refunds.createAtomic(actor, id, dto, receipt);
    return receipt.response.responseBody;
  }
}
