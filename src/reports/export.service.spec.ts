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
  const businessFindFirst = jest.fn();
  const prisma = {
    payrollRecord: { findMany: payrollFindMany },
    business: { findFirst: businessFindFirst },
  } as unknown as PrismaService;

  beforeEach(() => {
    payrollFindMany.mockReset();
    businessFindFirst.mockReset();
    businessFindFirst.mockResolvedValue({ name: 'SunTech Dhaka' });
    payrollFindMany.mockResolvedValue([]);
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

  it('returns payroll rows as a csv attachment', async () => {
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
      },
    );
    const csv = await readStream(file);

    expect(file.getHeaders().type).toBe('text/csv; charset=utf-8');
    expect(csv).toContain(
      'Cashier Name,Base Salary,Advances Deducted,Net Paid',
    );
    expect(csv).toContain('"Rafi, Jr.",30000,5000,25000');
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
