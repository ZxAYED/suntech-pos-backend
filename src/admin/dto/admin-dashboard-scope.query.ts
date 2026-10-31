import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AdminDashboardScopeQueryDto {
  @ApiPropertyOptional({
    description: 'Business UUID (required for ADMIN and SUPER_ADMIN)',
    example: 'ebe92401-283a-4051-ab26-ad5de25efe94',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({
    description: 'Location UUID (required for ADMIN and SUPER_ADMIN)',
    example: '4f519362-7b1d-424d-af55-3274c72711d6',
  })
  @IsOptional()
  @IsString()
  locationId?: string;
}
