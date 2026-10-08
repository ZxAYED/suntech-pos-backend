export function toCsv(
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));

  return `${lines.join('\n')}\n`;
}

function csvCell(value: string | number): string {
  const text = String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
