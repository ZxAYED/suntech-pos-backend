import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class OpenShiftDto {
  @ApiProperty({
    description: 'Opening cash float amount (in cents/paisa)',
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
    description: 'Location ID (required for Admin, implicit for Cashier)',
  })
  @IsOptional()
  @IsEntityId()
  locationId?: string;
}
