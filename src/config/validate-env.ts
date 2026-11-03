const REQUIRED_ENV = [
  'NODE_ENV',
  'DATABASE_URL',
  'PORT',
  'FRONTEND_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_RESET_SECRET',
  'JWT_ACCESS_TTL',
  'JWT_REFRESH_TTL',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'MAIL_FROM',
] as const;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_ENV.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (!['development', 'test', 'production'].includes(String(config.NODE_ENV))) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  for (const key of ['PORT', 'SMTP_PORT'] as const) {
    const number = Number(config[key]);
    if (!Number.isInteger(number) || number < 1 || number > 65535) {
      throw new Error(`${key} must be an integer TCP port between 1 and 65535`);
    }
  }

  if (
    config.NODE_ENV === 'production' &&
    /localhost|127\.0\.0\.1/.test(String(config.FRONTEND_URL))
  ) {
    throw new Error('FRONTEND_URL must point to the deployed frontend in production');
  }

  return config;
}
