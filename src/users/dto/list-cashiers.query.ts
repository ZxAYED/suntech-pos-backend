import { ApiPropertyOptional } from '@nestjs/swagger';
import { AccountStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ListCashiersQueryDto {
  @ApiPropertyOptional({
    description: 'Filter cashiers by business UUID (for Admin/SuperAdmin)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({
    description: 'Filter cashiers by branch location UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({
    enum: AccountStatus,
    enumName: 'AccountStatus',
    description: 'Filter cashiers by account status (ACTIVE, SUSPENDED, etc.)',
    example: AccountStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({
    description: 'Search by cashier full name, public ID, or phone',
    example: 'Alex',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
