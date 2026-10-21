import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';

export function IsEntityId() {
  return applyDecorators(IsString(), MinLength(1), MaxLength(64));
}
