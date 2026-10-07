import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';
import { SalaryMaskingInterceptor } from './salary-masking.interceptor';

describe('SalaryMaskingInterceptor', () => {
  const interceptor = new SalaryMaskingInterceptor();
  const payload = {
    id: 'user-1',
    monthlySalary: 25000,
    location: { name: 'Counter', monthlySalary: 1 },
  };

  function contextFor(role?: Role): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    } as ExecutionContext;
  }

  function next(): CallHandler {
    return { handle: () => of(payload) };
  }

  it('removes monthlySalary anywhere in the payload for a cashier', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextFor(Role.CASHIER), next()),
    );

    expect(result).toEqual({
      id: 'user-1',
      location: { name: 'Counter' },
    });
  });

  it('leaves monthlySalary visible for an admin', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextFor(Role.ADMIN), next()),
    );

    expect(result).toEqual(payload);
  });
});
