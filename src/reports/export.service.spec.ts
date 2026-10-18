import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PassThrough } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { ReportFormat, ReportType } from './dto/export-report.query';
import { ExportService } from './export.service';
import { PdfService } from './pdf.service';

describe('ExportService', () => {
  const payrollFindMany = jest.fn();
  const orderFindMany = jest.fn();
  const businessFindFirst = jest.fn();
  const prisma = {
    payrollRecord: { findMany: payrollFindMany },
    order: { findMany: orderFindMany },
    business: { findFirst: businessFindFirst },
  } as unknown as PrismaService;

  beforeEach(() => {
    payrollFindMany.mockReset();
    orderFindMany.mockReset();
    businessFindFirst.mockReset();
    businessFindFirst.mockResolvedValue({ name: 'SunTech Dhaka' });
    payrollFindMany.mockResolvedValue([]);
    orderFindMany.mockResolvedValue([]);
  });

  it('still returns a pdf when the payroll month has no records', async () => {
    const file = await new ExportService(prisma, new PdfService()).export(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      {
        type: ReportType.PAYROLL,
        format: ReportFormat.PDF,
        month: 10,
        year: 2026,
      },
    );
    const pdf = await readStream(file);

    const text = [...pdf.matchAll(/\[(.*?)\]\s*TJ/gs)]
      .map((run) =>
        [...run[1].matchAll(/<([0-9A-Fa-f]+)>/g)]
          .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
          .join(''),
      )
      .join('');

    expect(file.getHeaders().type).toBe('application/pdf');
    expect(file.getHeaders().disposition).toContain(
      'suntech-payroll-2026-10.pdf',
    );
    expect(text).toContain('Empty Report');
    expect(text).toContain('Payroll report');
  });

  it('returns payroll rows as a csv attachment and filters by locationId', async () => {
    payrollFindMany.mockResolvedValue([
      {
        baseSalary: 30000,
        totalAdvancesDeducted: 5000,
        netPaid: 25000,
        cashier: { fullName: 'Rafi, Jr.' },
      },
    ]);
    const file = await new ExportService(prisma, new PdfService()).export(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      {
        type: ReportType.PAYROLL,
        format: ReportFormat.CSV,
        month: 10,
        year: 2026,
        locationId: 'loc-1',
      },
    );
    const csv = await readStream(file);

    expect(payrollFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: 'biz-1',
          cashier: { locationId: 'loc-1' },
        }),
      }),
    );
    expect(file.getHeaders().type).toBe('text/csv; charset=utf-8');
    expect(csv).toContain(
      'Cashier Name,Base Salary,Advances Deducted,Net Paid',
    );
    expect(csv).toContain('"Rafi, Jr.",30000,5000,25000');
  });

  it('exports sales report with locationId and search filter in csv', async () => {
    orderFindMany.mockResolvedValue([
      {
        invoiceNumber: 'INV-100',
        receiptNumber: 'REC-100',
        createdAt: new Date('2026-10-15T12:00:00Z'),
        customerName: 'Karim',
        customerPhone: '01700000000',
        customerNumber: '01700000000',
        totalAmount: 1500,
        cashier: { fullName: 'Alex Rivera' },
        refunds: [{ totalRefund: 200 }],
      },
    ]);

    const file = await new ExportService(prisma, new PdfService()).export(
      { sub: 'admin-1', role: Role.ADMIN, businessId: 'biz-1' },
      {
        type: ReportType.SALES,
        format: ReportFormat.CSV,
        month: 10,
        year: 2026,
        locationId: 'loc-1',
        search: 'Karim',
      },
    );

    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          locationId: 'loc-1',
          cashier: { businessId: 'biz-1' },
          OR: expect.arrayContaining([
            { customerName: { contains: 'Karim', mode: 'insensitive' } },
          ]),
        }),
      }),
    );
    const csv = await readStream(file);
    expect(csv).toContain('INV-100');
    expect(csv).toContain('Karim');
    expect(csv).toContain('1500,200,1300');
  });
});

function readStream(file: StreamableFile): Promise<string> {
  const stream = file.getStream() as PassThrough;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    stream.on('error', reject);
  });
}
