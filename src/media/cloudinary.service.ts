import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadApiResponse, v2 as cloudinary } from 'cloudinary';
import { assertImageFile, UploadedImage } from './uploaded-image';

export interface StoredImage {
  url: string;
  publicId: string;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(configService: ConfigService) {
    cloudinary.config({
      cloud_name: configService.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: configService.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: configService.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  async uploadImage(file: UploadedImage, folder: string): Promise<StoredImage> {
    assertImageFile(file);

    const uploaded = await this.uploadBuffer(file.buffer, {
      folder,
      resource_type: 'image',
      unique_filename: true,
      overwrite: false,
    });

    return {
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
    };
  }

  async uploadImages(
    files: UploadedImage[],
    folder: string,
  ): Promise<StoredImage[]> {
    const stored: StoredImage[] = [];

    try {
      for (const file of files) {
        stored.push(await this.uploadImage(file, folder));
      }

      return stored;
    } catch (error) {
      await this.deleteImages(stored.map((image) => image.publicId));
      throw error;
    }
  }

  async deleteImage(publicId: string | null | undefined): Promise<void> {
    if (!publicId) {
      return;
    }

    const result = (await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
      invalidate: true,
    })) as { result?: string };

    if (result.result === 'ok' || result.result === 'not found') {
      return;
    }

    throw new BadGatewayException('Could not delete the image');
  }

  async deleteImages(publicIds: string[]): Promise<void> {
    await Promise.all(publicIds.map((publicId) => this.deleteImage(publicId)));
  }

  private uploadBuffer(
    buffer: Buffer,
    options: {
      folder: string;
      resource_type: 'image';
      unique_filename: boolean;
      overwrite: boolean;
    },
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        options,
        (error, result) => {
          if (error) {
            this.logger.error(error.message);
            reject(new BadGatewayException('Could not upload the image'));
            return;
          }

          if (!result?.secure_url || !result.public_id) {
            reject(new BadGatewayException('Could not upload the image'));
            return;
          }

          resolve(result);
        },
      );

      stream.end(buffer);
    });
  }
}
