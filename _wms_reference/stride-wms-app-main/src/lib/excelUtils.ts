import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/**
 * Read an ArrayBuffer into an ExcelJS Workbook.
 */
export async function readWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/**
 * Convert the first worksheet in a workbook to an array of plain objects,
 * mirroring XLSX.utils.sheet_to_json() behaviour.
 * Row 1 is treated as headers; subsequent rows become objects keyed by header.
 */
export function sheetToJson<T extends Record<string, unknown> = Record<string, unknown>>(
  worksheet: ExcelJS.Worksheet,
): T[] {
  const rows: T[] = [];
  const headerRow = worksheet.getRow(1);
  const headers: (string | undefined)[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cell.value != null ? String(cell.value) : undefined;
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, unknown> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (!key) return;
      const val = extractCellValue(cell);
      obj[key] = val;
      if (val !== null && val !== undefined && val !== '') hasValue = true;
    });
    if (hasValue) rows.push(obj as T);
  });

  return rows;
}

/**
 * Convert a worksheet to an array of arrays (like XLSX.utils.sheet_to_json with header: 1).
 * Every row (including the header) is returned as unknown[].
 */
export function sheetToAoa(worksheet: ExcelJS.Worksheet): unknown[][] {
  const result: unknown[][] = [];
  worksheet.eachRow((row, _rowNumber) => {
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      // Ensure the array is at least as long as the column index (1-based)
      while (cells.length < colNumber) cells.push(undefined);
      cells[colNumber - 1] = extractCellValue(cell);
    });
    result.push(cells);
  });
  return result;
}

/**
 * Create a new workbook, add a worksheet from an array of JSON objects, and return both.
 * Mimics: ws = XLSX.utils.json_to_sheet(data); wb = book_new(); book_append_sheet(wb, ws, name);
 */
export function jsonToWorkbook(
  data: Record<string, unknown>[],
  sheetName: string,
): { workbook: ExcelJS.Workbook; worksheet: ExcelJS.Worksheet } {
  const workbook = new ExcelJS.Workbook();
  const worksheet = addJsonSheet(workbook, data, sheetName);
  return { workbook, worksheet };
}

/**
 * Add a worksheet from JSON data to an existing workbook.
 * Returns the created worksheet.
 */
export function addJsonSheet(
  workbook: ExcelJS.Workbook,
  data: Record<string, unknown>[],
  sheetName: string,
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName);
  if (data.length === 0) return ws;

  const keys = Object.keys(data[0]);
  ws.columns = keys.map((key) => ({ header: key, key }));
  ws.addRows(data);
  return ws;
}

/**
 * Add a worksheet from an array of arrays to an existing workbook.
 * Returns the created worksheet.
 */
export function addAoaSheet(
  workbook: ExcelJS.Workbook,
  rows: unknown[][],
  sheetName: string,
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName);
  for (const row of rows) {
    ws.addRow(row);
  }
  return ws;
}

/**
 * Set column widths on a worksheet.
 * Accepts an array of widths (in approximate character counts).
 */
export function setColumnWidths(worksheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    const col = worksheet.getColumn(i + 1);
    col.width = w;
  });
}

/**
 * Write workbook to buffer, then trigger a browser download via file-saver.
 */
export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), filename);
}

/**
 * Extract a primitive value from an ExcelJS cell.
 * Rich-text objects are flattened to plain strings.
 */
function extractCellValue(cell: ExcelJS.Cell): unknown {
  const val = cell.value;
  if (val === null || val === undefined) return val;

  // ExcelJS rich text: { richText: [{ text: '...' }, ...] }
  if (typeof val === 'object' && 'richText' in val && Array.isArray((val as { richText: { text: string }[] }).richText)) {
    return (val as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }

  // ExcelJS formula result (covers both { formula, result } and { sharedFormula, result })
  if (typeof val === 'object' && 'formula' in val) {
    return (val as { result?: unknown }).result ?? null;
  }

  // ExcelJS shared formula without own formula property
  if (typeof val === 'object' && 'sharedFormula' in val) {
    return (val as { result?: unknown }).result ?? null;
  }

  // ExcelJS error
  if (typeof val === 'object' && 'error' in val) {
    return null;
  }

  // Date objects – return as-is (callers can handle)
  if (val instanceof Date) {
    return val;
  }

  return val;
}
