import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class OfflineContextQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId?: string;
  @ApiPropertyOptional({ description: 'Selected business ID for Admin' })
  @IsOptional()
  @IsString()
  businessId?: string;
  @ApiPropertyOptional({ description: 'Selected branch ID for Admin' })
  @IsOptional()
  @IsString()
  locationId?: string;
}
