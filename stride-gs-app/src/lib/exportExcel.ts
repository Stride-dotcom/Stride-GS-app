/**
 * exportExcel — generic "rows → single-sheet .xlsx" download helper.
 *
 * Produces a genuine Excel workbook (not a CSV with an .xlsx name) via SheetJS,
 * matching the pattern in components/pricelist/exportPriceListExcel.ts. Column
 * order follows the key order of the first row object; widths auto-size to the
 * longest cell so the sheet is readable on open.
 */
import * as XLSX from 'xlsx';

function autoSize(rows: Array<Record<string, unknown>>): XLSX.ColInfo[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map(key => {
    let maxLen = key.length;
    for (const r of rows) {
      const v = r[key];
      const s = v == null ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    }
    return { wch: Math.min(60, Math.max(10, maxLen + 2)) };
  });
}

/**
 * Download `rows` as a one-sheet .xlsx. Safe with an empty array (emits an
 * empty sheet). Sheet names are sanitized to Excel's rules (≤31 chars, no
 * : \ / ? * [ ]).
 */
export function downloadRowsAsExcel(
  rows: Array<Record<string, unknown>>,
  sheetName: string,
  filename: string,
): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = autoSize(rows);
  const safeSheet = (sheetName || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeSheet);
  XLSX.writeFile(wb, filename);
}
