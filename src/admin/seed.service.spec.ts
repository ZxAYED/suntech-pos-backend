import { AccountStatus, Role } from '@prisma/client';
import { runDatabaseSeed, SeedService } from './seed.service';

describe('SeedService & runDatabaseSeed', () => {
  const originalEnv = { ...process.env };
  const userUpsert = jest.fn();
  const userFindFirst = jest.fn();

  const prismaMock = {
    user: {
      upsert: userUpsert,
      findFirst: userFindFirst,
    },
  } as any;

  beforeEach(() => {
    process.env = { ...originalEnv };
    userUpsert.mockReset();
    userFindFirst.mockReset();
    userFindFirst.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips onModuleInit when RUN_BOOTSTRAP_SEED is not true', async () => {
    process.env.NODE_ENV = 'development';
    process.env.RUN_BOOTSTRAP_SEED = 'false';

    const service = new SeedService(prismaMock);
    await service.onModuleInit();

    expect(userUpsert).not.toHaveBeenCalled();
  });

  it('skips onModuleInit when NODE_ENV is test', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RUN_BOOTSTRAP_SEED = 'true';

    const service = new SeedService(prismaMock);
    await service.onModuleInit();

    expect(userUpsert).not.toHaveBeenCalled();
  });

  it('throws an error if super admin credentials are missing when running seed', async () => {
    delete process.env.SUPER_ADMIN_EMAIL;
    delete process.env.SUPER_ADMIN_PASSWORD;

    await expect(runDatabaseSeed(prismaMock)).rejects.toThrow(
      'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required to run the bootstrap seed',
    );
  });

  it('uses empty update object on upsert so existing accounts are not overwritten', async () => {
    process.env.SUPER_ADMIN_EMAIL = 'super@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'password123';

    userUpsert.mockResolvedValue({
      id: 'super-1',
      email: 'super@example.com',
      role: Role.SUPER_ADMIN,
    });

    await runDatabaseSeed(prismaMock);

    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'super@example.com' },
        update: {},
      }),
    );
  });

  it('throws an error if DEFAULT_ADMIN_EMAIL equals SUPER_ADMIN_EMAIL', async () => {
    process.env.SUPER_ADMIN_EMAIL = 'same@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'password123';
    process.env.DEFAULT_ADMIN_EMAIL = 'same@example.com';
    process.env.DEFAULT_ADMIN_PASSWORD = 'password123';

    userUpsert.mockResolvedValue({
      id: 'super-1',
      email: 'same@example.com',
      role: Role.SUPER_ADMIN,
    });

    await expect(runDatabaseSeed(prismaMock)).rejects.toThrow(
      'DEFAULT_ADMIN_EMAIL must differ from SUPER_ADMIN_EMAIL',
    );
  });
});
