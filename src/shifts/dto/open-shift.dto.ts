import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class OpenShiftDto {
  @ApiProperty({
    description: 'Opening cash float amount in whole BDT',
    example: 5000,
    minimum: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startingAmount: number;

  @ApiPropertyOptional({
    description: 'Auto-close any previous open shift left unclosed',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoClosePrevious?: boolean;

  @ApiPropertyOptional({
    description:
      'Tenant business ID for Admin. Cashier shifts always use the business in the access token and ignore this field.',
  })
  @IsOptional()
  @IsEntityId()
  businessId?: string;

  @ApiPropertyOptional({
    description:
      'Location ID for Admin. Cashier shifts always use the location in the access token and ignore this field.',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;
}
