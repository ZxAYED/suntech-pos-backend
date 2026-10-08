import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './order.controller';
import { OrdersService } from './order.service';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';

@Module({
  imports: [AuthModule],
  controllers: [OrdersController, RefundController],
  providers: [OrdersService, RefundService],
  exports: [OrdersService],
})
export class OrdersModule {}
