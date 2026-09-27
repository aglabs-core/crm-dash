export function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? '');
  // Spreadsheet programs can evaluate cells beginning with these characters.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) && typeof value === 'string') text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvFile(rows: Array<Array<string | number | null | undefined>>): string {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}
