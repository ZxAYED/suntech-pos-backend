import { AccountStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

const lifecycleStatuses = [
  AccountStatus.ACTIVE,
  AccountStatus.SUSPENDED,
  AccountStatus.REJECTED,
] as const;

export class UpdateUserStatusDto {
  @IsEnum(lifecycleStatuses)
  status: (typeof lifecycleStatuses)[number];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  statusReason?: string;
}
