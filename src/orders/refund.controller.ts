import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { CreateRefundDto } from './dto/create-refund.dto';
import { RefundService } from './refund.service';

@ApiTags('Orders - Refunds')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  @Post(':id/refunds')
  @ApiOperation({
    summary: 'Process partial or full order refund',
    description:
      'Refunds specified order items. If order becomes fully refunded, marks Order.status = REFUNDED. For COD orders associated with a shift, decrements drawer cashCollected.',
  })
  @ApiResponse({ status: 201, description: 'Refund completed' })
  @ApiResponse({
    status: 400,
    description: 'Invalid refund quantities or order not refundable',
  })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Refund completed')
  create(
    @CurrentUser() admin: AccessTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refunds.create(admin, id, dto);
  }
}
