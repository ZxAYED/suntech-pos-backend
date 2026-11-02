import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

const lifecycleStatuses = [
  AccountStatus.ACTIVE,
  AccountStatus.SUSPENDED,
  AccountStatus.REJECTED,
] as const;

export class UpdateUserStatusDto {
  @ApiPropertyOptional({
    description: 'Target business UUID for multi-business Admin',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;

  @ApiProperty({
    enum: lifecycleStatuses,
    enumName: 'AccountLifecycleStatus',
    description: 'Account status (ACTIVE, SUSPENDED, or REJECTED)',
    example: AccountStatus.SUSPENDED,
  })
  @IsEnum(lifecycleStatuses)
  status: (typeof lifecycleStatuses)[number];

  @ApiPropertyOptional({
    description: 'Audit reason for account status update',
    example: 'Policy violation during shift handover',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  statusReason?: string;
}
