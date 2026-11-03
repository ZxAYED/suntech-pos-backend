import { validateEnv } from './validate-env';

describe('validateEnv', () => {
  const validConfig = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    PORT: '3000',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_RESET_SECRET: 'reset-secret',
    JWT_ACCESS_TTL: '7d',
    JWT_REFRESH_TTL: '30d',
    CLOUDINARY_CLOUD_NAME: 'cloud',
    CLOUDINARY_API_KEY: '12345',
    CLOUDINARY_API_SECRET: 'secret',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'password',
    MAIL_FROM: 'noreply@example.com',
  };

  it('validates a complete, valid environment configuration', () => {
    const validated = validateEnv({ ...validConfig });
    expect(validated).toEqual(validConfig);
  });

  it('throws an error if a required environment variable is missing', () => {
    const invalidConfig = { ...validConfig };
    delete (invalidConfig as any).JWT_RESET_SECRET;

    expect(() => validateEnv(invalidConfig)).toThrow(
      'Missing required environment variables: JWT_RESET_SECRET',
    );
  });

  it('throws an error if NODE_ENV is invalid', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'staging',
      }),
    ).toThrow('NODE_ENV must be development, test, or production');
  });

  it('throws an error if PORT is not a valid TCP port number', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        PORT: '99999',
      }),
    ).toThrow('PORT must be an integer TCP port between 1 and 65535');

    expect(() =>
      validateEnv({
        ...validConfig,
        PORT: '0',
      }),
    ).toThrow('PORT must be an integer TCP port between 1 and 65535');
  });

  it('throws an error in production if FRONTEND_URL is localhost', () => {
    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        FRONTEND_URL: 'http://localhost:3000',
      }),
    ).toThrow('FRONTEND_URL must point to the deployed frontend in production');

    expect(() =>
      validateEnv({
        ...validConfig,
        NODE_ENV: 'production',
        FRONTEND_URL: 'http://127.0.0.1:3000',
      }),
    ).toThrow('FRONTEND_URL must point to the deployed frontend in production');
  });

  it('allows valid external FRONTEND_URL in production', () => {
    const prodConfig = {
      ...validConfig,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://pos.suntech.com',
    };
    expect(validateEnv(prodConfig)).toEqual(prodConfig);
  });
});
