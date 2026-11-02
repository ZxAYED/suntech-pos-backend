jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class MockAuthGuard {},
  PassportStrategy: () => class MockPassportStrategy {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './order.controller';
import { OrdersService } from './order.service';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: OrdersService;

  const mockOrdersService = {
    createCatalogOrder: jest.fn(),
    createCustomOrder: jest.fn(),
    getOrders: jest.fn(),
    getOrderById: jest.fn(),
    checkout: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    service = module.get<OrdersService>(OrdersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createCatalogOrder', () => {
    it('delegates to ordersService.createCatalogOrder with userId and dto', async () => {
      const dto = {
        locationId: 'loc-1',
        tenderedAmount: 2000,
        lines: [{ variantId: 'var-1', quantity: 1, unitPrice: 2000 }],
      };
      const expectedResult = { id: 'order-1', totalAmount: 2000 };
      mockOrdersService.createCatalogOrder.mockResolvedValue(expectedResult);

      const result = await controller.createCatalogOrder('user-1' as any, dto as any);

      expect(service.createCatalogOrder).toHaveBeenCalledWith('user-1' as any, dto);
      expect(result).toBe(expectedResult);
    });
  });

  describe('createCustomOrder', () => {
    it('delegates to ordersService.createCustomOrder with userId and dto', async () => {
      const dto = {
        locationId: 'loc-1',
        tenderedAmount: 500,
        lines: [{ productName: 'Repair', quantity: 1, unitPrice: 500 }],
      };
      const expectedResult = { id: 'order-2', totalAmount: 500 };
      mockOrdersService.createCustomOrder.mockResolvedValue(expectedResult);

      const result = await controller.createCustomOrder('user-1' as any, dto as any);

      expect(service.createCustomOrder).toHaveBeenCalledWith('user-1' as any, dto);
      expect(result).toBe(expectedResult);
    });
  });

  describe('getOrders', () => {
    it('delegates to ordersService.getOrders with query filters', async () => {
      const expectedResult = { items: [], page: 1, limit: 20, total: 0 };
      mockOrdersService.getOrders.mockResolvedValue(expectedResult);

      const result = await (controller.getOrders as any)('loc-1', 'CATALOG', 1, 20);

      expect(service.getOrders).toHaveBeenCalledWith({
        locationId: 'loc-1',
        orderType: 'CATALOG',
        page: 1,
        limit: 20,
      });
    });
  });

  describe('getOrderById', () => {
    it('delegates to ordersService.getOrderById with actor and id', async () => {
      const actor = {
        sub: 'user-1',
        role: 'ADMIN' as const,
        businessId: 'biz-1',
      };
      const expectedResult = { id: 'order-123', totalAmount: 1500, lines: [] };
      mockOrdersService.getOrderById.mockResolvedValue(expectedResult);

      const result = await controller.getOrderById(actor, 'order-123');

      expect(service.getOrderById).toHaveBeenCalledWith(actor, 'order-123');
      expect(result).toBe(expectedResult);
    });
  });
});
