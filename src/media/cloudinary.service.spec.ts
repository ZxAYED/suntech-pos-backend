import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Writable } from 'stream';
import { CloudinaryService } from './cloudinary.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

import { v2 as cloudinary } from 'cloudinary';

describe('CloudinaryService', () => {
  const configService = {
    getOrThrow: jest.fn((key: string) => key),
  } as unknown as ConfigService;
  const service = new CloudinaryService(configService);
  const uploadStream = cloudinary.uploader.upload_stream as jest.Mock;
  const destroy = cloudinary.uploader.destroy as jest.Mock;

  beforeEach(() => {
    uploadStream.mockReset();
    destroy.mockReset();
  });

  it('rejects a file that is not an image', async () => {
    await expect(
      service.uploadImage(
        { buffer: Buffer.from('hello'), mimetype: 'text/plain', size: 5 },
        'suntech/users',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it('stores the secure url and public id returned by Cloudinary', async () => {
    uploadStream.mockImplementation(
      (
        _options: unknown,
        callback: (error: undefined, result: object) => void,
      ) => {
        const stream = new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        });
        stream.on('finish', () => {
          callback(undefined, {
            secure_url: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
            public_id: 'suntech/users/a',
          });
        });
        return stream;
      },
    );

    const stored = await service.uploadImage(
      {
        buffer: Buffer.from('image'),
        mimetype: 'image/png',
        size: 5,
      },
      'suntech/users/user-1',
    );

    expect(stored).toEqual({
      url: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
      publicId: 'suntech/users/a',
    });
  });

  it('treats a missing Cloudinary asset as already deleted', async () => {
    destroy.mockResolvedValue({ result: 'not found' });

    await expect(
      service.deleteImage('suntech/users/missing'),
    ).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledWith('suntech/users/missing', {
      resource_type: 'image',
      invalidate: true,
    });
  });
});
