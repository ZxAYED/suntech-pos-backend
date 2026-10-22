import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CustomAttributeDto {
  @ApiProperty({
    description:
      'Attribute key or label (e.g. IMEI, Serial Number, Warranty, Model, Color)',
    example: 'IMEI',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  key: string;

  @ApiProperty({
    description: 'Attribute value (e.g. 358249012345678 or 1 Year)',
    example: '358249012345678',
  })
  @IsNotEmpty()
  value: any;

  @ApiPropertyOptional({
    description: 'Optional alias name field matching key',
    example: 'IMEI',
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export interface NormalizedCustomAttribute {
  key: string;
  value: any;
}

/**
 * Normalizes custom attributes received in multiple flexible formats:
 * 1. Array of objects: [{ key: 'IMEI', value: '123' }] or [{ name: 'IMEI', value: '123' }]
 * 2. Key-value dictionary / map: { IMEI: '123', Warranty: '1 Year' }
 * 3. JSON serialized string: '[{"key":"IMEI","value":"123"}]' or '{"IMEI":"123"}'
 * Returns an array of normalized { key, value } pairs or null if empty.
 */
export function normalizeCustomAttributes(
  raw: unknown,
): NormalizedCustomAttribute[] | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  let parsed = raw;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (
      !trimmed ||
      trimmed === 'null' ||
      trimmed === '[]' ||
      trimmed === '{}'
    ) {
      return null;
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [{ key: 'custom', value: trimmed }];
    }
  }

  if (Array.isArray(parsed)) {
    const list: NormalizedCustomAttribute[] = [];
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const anyItem = item as Record<string, any>;
        const key = (
          anyItem.key ??
          anyItem.name ??
          anyItem.label ??
          anyItem.attribute ??
          ''
        )
          .toString()
          .trim();
        const value = anyItem.value ?? anyItem.val ?? anyItem.content;
        if (key && value !== undefined && value !== null) {
          list.push({ key, value });
        }
      }
    }
    return list.length > 0 ? list : null;
  }

  if (typeof parsed === 'object') {
    const list: NormalizedCustomAttribute[] = [];
    for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
      if (v !== undefined && v !== null && k.trim()) {
        list.push({ key: k.trim(), value: v });
      }
    }
    return list.length > 0 ? list : null;
  }

  return null;
}
