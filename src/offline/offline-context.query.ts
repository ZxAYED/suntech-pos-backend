import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class OfflineContextQueryDto {
  @ApiPropertyOptional({ description: 'Selected business ID for Admin' })
  @IsOptional()
  @IsString()
  businessId?: string;
  @ApiPropertyOptional({ description: 'Selected branch ID for Admin' })
  @IsOptional()
  @IsString()
  locationId?: string;
}
