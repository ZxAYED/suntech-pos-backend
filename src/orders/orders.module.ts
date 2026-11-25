import { AdvancedOfflineCommandsController } from './advanced-offline-commands.controller';
import { AdvancedOfflineCommandsService } from './advanced-offline-commands.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './order.controller';
import { OrdersService } from './order.service';
import { RefundController } from './refund.controller';
import { RefundService } from './refund.service';
import { OfflineModule } from '../offline/offline.module';
import { LocalFirstOrdersController } from './local-first-orders.controller';
import { LocalFirstOrdersService } from './local-first-orders.service';

@Module({
  imports: [AuthModule, OfflineModule],
  controllers: [OrdersController, RefundController, LocalFirstOrdersController, AdvancedOfflineCommandsController],
  providers: [OrdersService, RefundService, LocalFirstOrdersService, AdvancedOfflineCommandsService],
  exports: [OrdersService],
})
export class OrdersModule {}
