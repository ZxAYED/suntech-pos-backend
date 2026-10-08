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

      const result = await controller.createCatalogOrder('user-1', dto);

      expect(service.createCatalogOrder).toHaveBeenCalledWith('user-1', dto);
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

      const result = await controller.createCustomOrder('user-1', dto);

      expect(service.createCustomOrder).toHaveBeenCalledWith('user-1', dto);
      expect(result).toBe(expectedResult);
    });
  });

  describe('getOrders', () => {
    it('delegates to ordersService.getOrders with query filters', async () => {
      const expectedResult = { items: [], page: 1, limit: 20, total: 0 };
      mockOrdersService.getOrders.mockResolvedValue(expectedResult);

      const result = await controller.getOrders('loc-1', 'CATALOG', 1, 20);

      expect(service.getOrders).toHaveBeenCalledWith({
        locationId: 'loc-1',
        orderType: 'CATALOG',
        page: 1,
        limit: 20,
      });
      expect(result).toBe(expectedResult);
    });
  });
});
