import { Injectable, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessTokenPayload } from '../common/types/access-token-payload';
import { requireBusinessId } from '../hr/require-business-id';
import { payrollPeriod } from '../hr/payroll-period';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from './csv';
import {
  ExportReportQueryDto,
  ReportFormat,
  ReportType,
} from './dto/export-report.query';
import { PdfService } from './pdf.service';

const PAYROLL_COLUMNS = [
  'Cashier Name',
  'Base Salary',
  'Advances Deducted',
  'Net Paid',
];

const SALES_COLUMNS = [
  'Receipt',
  'Date',
  'Cashier',
  'Customer',
  'Total',
  'Refunded',
  'Net',
];

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfService,
  ) {}

  async export(
    admin: AccessTokenPayload,
    query: ExportReportQueryDto,
  ): Promise<StreamableFile> {
    const businessId = requireBusinessId(admin, query.businessId);
    const business = await this.prisma.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { name: true },
    });
    const subtitle = `${business?.name ?? 'SunTech'} · ${query.year}-${String(query.month).padStart(2, '0')}`;
    const table =
      query.type === ReportType.PAYROLL
        ? await this.payrollTable(businessId, query, subtitle)
        : await this.salesTable(businessId, query, subtitle);
    const filename = `suntech-${query.type}-${query.year}-${String(query.month).padStart(2, '0')}.${query.format}`;

    if (query.format === ReportFormat.CSV) {
      return new StreamableFile(Buffer.from(toCsv(table.columns, table.rows)), {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="${filename}"`,
      });
    }

    return new StreamableFile(this.pdf.render(table), {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  private async payrollTable(
    businessId: string,
    query: ExportReportQueryDto,
    subtitle: string,
  ) {
    const records = await this.prisma.payrollRecord.findMany({
      where: {
        businessId,
        month: query.month,
        year: query.year,
        ...(query.locationId
          ? { cashier: { locationId: query.locationId } }
          : {}),
      },
      select: {
        baseSalary: true,
        totalAdvancesDeducted: true,
        netPaid: true,
        cashier: { select: { fullName: true } },
      },
      orderBy: { cashier: { fullName: 'asc' } },
    });

    return {
      title: 'Payroll report',
      subtitle,
      columns: PAYROLL_COLUMNS,
      rows: records.map((record) => [
        record.cashier.fullName,
        String(record.baseSalary),
        String(record.totalAdvancesDeducted),
        String(record.netPaid),
      ]),
    };
  }

  private async salesTable(
    businessId: string,
    query: ExportReportQueryDto,
    subtitle: string,
  ) {
    const period = payrollPeriod(query.year, query.month);
    const where: Prisma.OrderWhereInput = {
      location: { businessId },
      occurredAt: { gte: period.start, lt: period.end },
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };

    if (query.search?.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
        { receiptNumber: { contains: searchTerm, mode: 'insensitive' } },
        { customerName: { contains: searchTerm, mode: 'insensitive' } },
        { customerPhone: { contains: searchTerm, mode: 'insensitive' } },
        { customerNumber: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        invoiceNumber: true,
        receiptNumber: true,
        occurredAt: true,
        customerName: true,
        customerPhone: true,
        customerNumber: true,
        totalAmount: true,
        cashier: { select: { fullName: true } },
        refunds: { select: { totalRefund: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    return {
      title: 'Sales report',
      subtitle,
      columns: SALES_COLUMNS,
      rows: orders.map((order) => {
        const refunded = order.refunds.reduce(
          (total, refund) => total + refund.totalRefund,
          0,
        );

        return [
          order.invoiceNumber ?? order.receiptNumber ?? '',
          order.occurredAt.toISOString().slice(0, 10),
          order.cashier.fullName,
          order.customerName ??
            order.customerPhone ??
            order.customerNumber ??
            '',
          String(order.totalAmount),
          String(refunded),
          String(order.totalAmount - refunded),
        ];
      }),
    };
  }
}
