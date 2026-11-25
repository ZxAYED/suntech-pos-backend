import { BadRequestException, ConflictException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

function render(error: unknown) {
  const response = { status: jest.fn(), json: jest.fn(), headersSent: false };
  response.status.mockReturnValue(response);
  new GlobalExceptionFilter().catch(error, {
    switchToHttp: () => ({ getResponse: () => response }),
  } as never);
  return {
    status: response.status.mock.calls[0][0],
    body: response.json.mock.calls[0][0],
  };
}

describe('HTTP recovery error contract', () => {
  it('preserves current-price correction fields through the actual global filter', () => {
    const result = render(
      new ConflictException({
        code: 'PRICE_CHANGED',
        message: 'Price changed',
        variantId: 'v1',
        submittedPrice: 100,
        currentPrice: 120,
        internalSecret: 'must-not-escape',
      }),
    );
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      success: false,
      code: 'PRICE_CHANGED',
      variantId: 'v1',
      submittedPrice: 100,
      currentPrice: 120,
    });
    expect(result.body).not.toHaveProperty('internalSecret');
  });

  it('keeps the existing simple error envelope for ordinary input errors', () => {
    expect(render(new BadRequestException('Old error')).body).toEqual({
      success: false,
      message: 'Old error',
      timestamp: expect.any(String),
    });
  });

  it('returns explicit HTTP 413 for request-size limits so a queue can reduce batch size', () => {
    const error = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });
    const result = render(error);
    expect(result.status).toBe(413);
    expect(result.body).toMatchObject({
      code: 'REQUEST_TOO_LARGE',
      success: false,
    });
  });

  it('preserves the original image upload size error behavior', () => {
    const error = Object.assign(new Error('File too large'), {
      name: 'MulterError',
      code: 'LIMIT_FILE_SIZE',
    });
    expect(render(error)).toEqual({
      status: 400,
      body: {
        success: false,
        message: 'Image must be 5 MB or smaller',
        timestamp: expect.any(String),
      },
    });
  });
});
