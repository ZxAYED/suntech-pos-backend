import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  imports: [AuthModule, IdentityModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
