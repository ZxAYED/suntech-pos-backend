import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';
import { SalaryMaskingInterceptor } from './salary-masking.interceptor';

describe('SalaryMaskingInterceptor', () => {
  const interceptor = new SalaryMaskingInterceptor();
  const payload = {
    id: 'user-1',
    name: 'Beverages__del_1729500000',
    monthlySalary: 25000,
    costPrice: 120,
    marginPercent: 25.5,
    inventoryValue: 50000,
    salesRevenue: 100000,
    salesCount: 42,
    location: { name: 'Counter__del_9999', monthlySalary: 1 },
  };

  function contextFor(role?: Role): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    } as ExecutionContext;
  }

  function next(data = payload): CallHandler {
    return { handle: () => of(data) };
  }

  it('removes management keys and strips soft-delete suffixes for a cashier', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextFor(Role.CASHIER), next()),
    );

    expect(result).toEqual({
      id: 'user-1',
      name: 'Beverages',
      location: { name: 'Counter' },
    });
  });

  it('leaves management keys visible for an admin but strips soft-delete suffixes', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextFor(Role.ADMIN), next()),
    );

    expect(result).toEqual({
      id: 'user-1',
      name: 'Beverages',
      monthlySalary: 25000,
      costPrice: 120,
      marginPercent: 25.5,
      inventoryValue: 50000,
      salesRevenue: 100000,
      salesCount: 42,
      location: { name: 'Counter', monthlySalary: 1 },
    });
  });
});
