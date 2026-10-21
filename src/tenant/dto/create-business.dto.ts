import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBusinessDto {
  @ApiProperty({
    description: 'Business company name',
    example: 'SunTech Retail Ltd.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}
