import { PdfService } from './pdf.service';
import { PassThrough } from 'stream';

describe('PdfService', () => {
  it('renders an empty payroll table instead of failing', async () => {
    const stream = new PdfService().render({
      title: 'Payroll report',
      subtitle: 'SunTech · 2026-10',
      columns: ['Cashier Name', 'Base Salary', 'Advances Deducted', 'Net Paid'],
      rows: [],
    });
    const pdf = await readPdf(stream);

    const text = pdfText(pdf);

    expect(pdf.includes('%PDF')).toBe(true);
    expect(text).toContain('Empty Report');
    expect(text).toContain('Payroll report');
    expect(pdf).toContain(
      '0.027450980392156862 0.043137254901960784 0.1568627450980392 scn',
    );
    expect(pdf).toContain('0 0.3215686274509804 1 scn');
  });
});

function pdfText(pdf: string): string {
  return [...pdf.matchAll(/\[(.*?)\]\s*TJ/gs)]
    .map((run) =>
      [...run[1].matchAll(/<([0-9A-Fa-f]+)>/g)]
        .map((hex) => Buffer.from(hex[1], 'hex').toString('latin1'))
        .join(''),
    )
    .join('');
}

function readPdf(stream: PassThrough): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    stream.on('error', reject);
  });
}
