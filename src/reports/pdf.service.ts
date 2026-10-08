import { Injectable } from '@nestjs/common';
import { existsSync } from 'fs';
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { PassThrough } from 'stream';

const NAVY = '#070B28';
const BLUE = '#0052FF';
const LOGO_PATH = join(process.cwd(), 'assets', 'image_0057bd.png');
const LOGO_SOURCE = 1024;
const LOGO_CONTENT = { x: 140, y: 410, width: 740, height: 200 };

export interface PdfReport {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
}

@Injectable()
export class PdfService {
  render(report: PdfReport): PassThrough {
    const document = new PDFDocument({
      size: 'A4',
      margin: 48,
      compress: false,
    });
    const stream = new PassThrough();
    document.pipe(stream);
    document.on('error', (error: Error) => stream.destroy(error));
    const contentTop = this.drawHeader(document, report.title);
    document.fillColor(BLUE).fontSize(11).text(report.subtitle, 48, contentTop);
    this.drawTable(document, report, contentTop + 24);
    document.end();

    return stream;
  }

  private drawHeader(document: PDFKit.PDFDocument, title: string): number {
    const pageWidth = document.page.width;
    document.rect(0, 0, pageWidth, 64).fill(NAVY);
    document.rect(0, 64, pageWidth, 4).fill(BLUE);
    document
      .fillColor('#FFFFFF')
      .fontSize(16)
      .text(title, 220, 24, {
        width: pageWidth - 268,
        align: 'right',
      });

    if (!existsSync(LOGO_PATH)) {
      document.fillColor('#FFFFFF').fontSize(20).text('SunTech', 48, 22);
      return 88;
    }

    const displayHeight = 42;
    const scale = displayHeight / LOGO_CONTENT.height;
    const displayWidth = LOGO_CONTENT.width * scale;
    const x = 48;
    const y = 84;
    document.save();
    document.rect(x, y, displayWidth, displayHeight).clip();
    document.image(
      LOGO_PATH,
      x - LOGO_CONTENT.x * scale,
      y - LOGO_CONTENT.y * scale,
      { width: LOGO_SOURCE * scale },
    );
    document.restore();

    return y + displayHeight + 16;
  }

  private drawTable(
    document: PDFKit.PDFDocument,
    report: PdfReport,
    startY: number,
  ): void {
    const rows =
      report.rows.length > 0
        ? report.rows
        : [this.emptyRow(report.columns.length)];
    let y = this.drawColumns(document, report.columns, startY);
    const pageBottom = document.page.height - 48;
    const width = document.page.width - 96;
    const columnWidth = width / report.columns.length;

    rows.forEach((row, rowIndex) => {
      if (y + 26 > pageBottom) {
        document.addPage();
        const nextTop = this.drawHeader(document, report.title);
        y = this.drawColumns(document, report.columns, nextTop);
      }

      if (rowIndex % 2 === 0) {
        document.rect(48, y, width, 26).fill('#F4F6F8');
      }

      document.fillColor(NAVY).fontSize(9);
      row.forEach((cell, index) => {
        document.text(cell, 56 + index * columnWidth, y + 8, {
          width: columnWidth - 16,
          lineBreak: false,
        });
      });
      y += 26;
    });
  }

  private drawColumns(
    document: PDFKit.PDFDocument,
    columns: string[],
    top: number,
  ): number {
    const width = document.page.width - 96;
    const columnWidth = width / columns.length;
    document.rect(48, top, width, 28).fill(NAVY);
    document.fillColor('#FFFFFF').fontSize(8);
    columns.forEach((column, index) => {
      document.text(column, 56 + index * columnWidth, top + 10, {
        width: columnWidth - 16,
        lineBreak: false,
      });
    });

    return top + 28;
  }

  private emptyRow(columns: number): string[] {
    return Array.from({ length: columns }, (_, index) =>
      index === 0 ? 'Empty Report' : '0',
    );
  }
}
