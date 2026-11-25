import { ApiProperty } from '@nestjs/swagger';
import { IsEntityId } from '../../common/decorators/is-entity-id.decorator';

export class ForceLogoutDto {
  @ApiProperty({
    description: 'Cashier User ID to force logout',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsEntityId()
  cashierId: string;
}

