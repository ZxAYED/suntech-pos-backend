import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VARIANT_IMAGES = 8;

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export const imageUploadOptions: MulterOptions = {
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_request, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(
        new BadRequestException('Image must be a JPEG, PNG, or WebP file'),
        false,
      );
      return;
    }

    callback(null, true);
  },
};

export function assertImageFile(
  file: UploadedImage | undefined,
): asserts file is UploadedImage {
  if (!file?.buffer?.length) {
    throw new BadRequestException('An image file is required');
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    throw new BadRequestException('Image must be a JPEG, PNG, or WebP file');
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new BadRequestException('Image must be 5 MB or smaller');
  }
}
