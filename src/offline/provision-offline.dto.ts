import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsEntityId } from '../common/decorators/is-entity-id.decorator';

export class ProvisionOfflineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceId: string;
  @IsOptional()
  @IsEntityId()
  businessId?: string;
  @IsOptional()
  @IsEntityId()
  locationId?: string;
}
