// ─── Excel export ────────────────────────────────────────────────────────────
// Workbooks are built in the browser with SheetJS and downloaded straight away.
// Dates go in as real date cells and money as numbers, so the sheets sort, sum
// and filter properly in Excel. SheetJS is loaded on first use, so it stays out
// of the main bundle.

export type Cell = string | number | Date | null;

export interface SheetSpec {
  name: string;
  /** Column headers, in order. */
  columns: string[];
  rows: Cell[][];
  /** Column widths in characters, matching `columns`. */
  widths?: number[];
}

export type ExportKind = 'driver' | 'rider' | 'topups' | 'commission';

const slug = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'all';

/** "dridez-driver-ali-khan-2026-10-15.xlsx" */
export const exportFileName = (kind: ExportKind, scope: string, d = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `dridez-${kind}-${slug(scope)}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.xlsx`;
};

/** Builds the workbook and hands it to the browser as a download. */
export const downloadWorkbook = async (fileName: string, sheets: SheetSpec[]): Promise<void> => {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows], {
      cellDates: true,
      dateNF: 'dd mmm yyyy hh:mm',
    });
    if (sheet.widths) ws['!cols'] = sheet.widths.map(wch => ({ wch }));
    // Sheet names: 31 characters, none of : \ / ? * [ ]
    XLSX.utils.book_append_sheet(book, ws, sheet.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31));
  }
  XLSX.writeFile(book, fileName, { compression: true });
};
