/**
 * stax-iif-shadow — [MIGRATION-P6] shared GAS-ported pure helpers.
 *
 * Faithful 1:1 ports of the Stax / IIF transform helpers from
 * StrideAPI.gs, used by `create-stax-invoices-sb` and `import-iif-sb`
 * shadow Edge Functions. Pure functions only — NO Supabase, Stax, QBO,
 * or any network client is constructed here (MIG-008: shadow handlers
 * never touch an external payment API; this module is inert by
 * construction). Keep these byte-for-byte equivalent to the GAS source
 * so the shadow↔GAS parity diff stays clean.
 *
 * GAS source anchors (StrideAPI.gs):
 *   stax_normalizeName_        :34334
 *   stax_parseDateForStax_     :35661
 *   stax_buildLineItems_       :35706
 *   stax_buildColumnMap_       :34443
 *   stax_parseTrnsFromMap_     :34455
 *   stax_parseTrnsPositional_  :34469
 *   stax_parseSplFromMap_      :34481
 *   stax_parseSplPositional_   :34495
 *   stax_routeParsedTransaction_:34508
 *   stax_parseIIF_             :34535
 *
 * Stride's Apps Script timezone is America/Los_Angeles, so every place
 * GAS calls Utilities.formatDate(d, Session.getScriptTimeZone(), …) we
 * format in that fixed zone. Pure calendar dates (MM/DD/YYYY and
 * yyyy-MM-dd inputs) are emitted by direct zero-pad with no Date
 * round-trip, which is timezone-invariant and matches GAS's output for
 * those branches exactly. Only the generic-fallback branch (an
 * already-odd input) goes through a real Date in the Pacific zone.
 */

const SCRIPT_TZ = 'America/Los_Angeles';

/** Zero-pad an integer to 2 digits. */
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/**
 * Format a Date as yyyy-MM-dd in Stride's Apps Script timezone.
 * Mirrors Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd').
 */
export function formatDatePacific(d: Date): string {
  // en-CA gives ISO-ordered yyyy-MM-dd parts; timeZone pins it to PT.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCRIPT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Format a Date as yyyy-MM-dd HH:mm:ss in Stride's Apps Script timezone.
 * Mirrors Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss').
 */
export function formatDateTimePacific(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCRIPT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let hour = get('hour');
  if (hour === '24') hour = '00'; // Intl can emit 24 at midnight
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

/** GAS stax_normalizeName_ — trim, lowercase, collapse internal whitespace. */
export function staxNormalizeName(name: unknown): string {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * GAS stax_parseDateForStax_ — normalize a date value to yyyy-MM-dd, or
 * null when unparseable. Supabase mirror columns are text, so the
 * Date-object branch never fires from SB reads, but it is preserved for
 * faithfulness when a caller passes a Date.
 */
export function staxParseDateForStax(dateStr: unknown): string | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) return null;
    return formatDatePacific(dateStr);
  }
  const s = String(dateStr).trim();
  if (!s) return null;

  // Try MM/DD/YYYY (pure calendar date — emit directly, TZ-invariant).
  const parts = s.split('/');
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // GAS builds new Date(year, month-1, day) then formats — for a
      // component-built local date with no time that is exactly
      // year-pad(month)-pad(day). Validate the day is real via a UTC
      // Date (matches GAS's !isNaN check without TZ skew).
      const probe = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(probe.getTime())) {
        return `${year}-${pad2(month)}-${pad2(day)}`;
      }
    }
  }

  // Try yyyy-MM-dd.
  const isoParts = s.split('-');
  if (isoParts.length === 3 && isoParts[0].length === 4) {
    const y = parseInt(isoParts[0], 10);
    const m = parseInt(isoParts[1], 10);
    const dd = parseInt(isoParts[2], 10);
    const probe = new Date(Date.UTC(y, m - 1, dd));
    if (!isNaN(probe.getTime())) {
      return `${y}-${pad2(m)}-${pad2(dd)}`;
    }
  }

  // Fallback generic parse (GAS: new Date(dateStr), then format in TZ).
  const fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return formatDatePacific(fallback);
  }
  return null;
}

export interface StaxLineItem {
  item: string;
  details: string;
  quantity: number;
  price: number;
}

/**
 * GAS stax_buildLineItems_ — parse the Line Items JSON column into Stax
 * line items, skipping Accounts-Receivable lines, with a single-line
 * fallback when nothing parses.
 */
export function staxBuildLineItems(
  lineItemsRaw: string,
  total: number,
  docNum: string,
): StaxLineItem[] {
  const items: StaxLineItem[] = [];
  try {
    const parsed = JSON.parse(lineItemsRaw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      for (let i = 0; i < parsed.length; i++) {
        const li = parsed[i] ?? {};
        if (li.accnt && /accounts receivable/i.test(li.accnt)) continue;

        const qty = li.qty || 1;
        let price = li.price ? Math.abs(li.price) : 0;
        if (!price && li.amount) {
          price = Math.abs(li.amount) / qty;
        }
        if (price === 0) continue;

        items.push({
          item: li.invItem || li.memo || ('Line ' + (i + 1)),
          details: li.memo || li.accnt || '',
          quantity: qty,
          price: price,
        });
      }
    }
  } catch (_e) {
    /* not valid JSON — use fallback */
  }

  if (items.length === 0) {
    items.push({
      item: 'QB Invoice #' + docNum,
      details: 'Invoice total',
      quantity: 1,
      price: total,
    });
  }
  return items;
}

// ─── IIF parsing (GAS stax_parseIIF_ + sub-parsers) ──────────────────────

export interface ParsedTrns {
  trnsType: string;
  date: string;
  accnt: string;
  name: string;
  amount: number;
  docNum: string;
  memo: string;
  terms: string;
  dueDate: string;
  clear: string;
  toPrint: string;
  lineItems: ParsedSpl[];
}

export interface ParsedSpl {
  trnsType: string;
  date: string;
  accnt: string;
  name: string;
  amount: number;
  docNum: string;
  memo: string;
  qty: number;
  price: number;
  invItem: string;
  clear: string;
}

export interface ParsedException {
  timestamp: string;
  docNum: string;
  name: string;
  staxId: string;
  amount: number;
  dueDate: string;
  reason: string;
  link: string;
  resolved: string;
}

export interface ParsedIIF {
  rows: string[][];
  invoices: ParsedTrns[];
  exceptions: ParsedException[];
}

type ColMap = Record<string, number>;

/** GAS stax_buildColumnMap_ — header parts → { COLNAME: index }. */
function buildColumnMap(headerParts: string[]): ColMap {
  const map: ColMap = {};
  for (let i = 1; i < headerParts.length; i++) {
    const col = headerParts[i].trim().toUpperCase();
    if (col) map[col] = i;
  }
  return map;
}

function numOr(v: string, fallback: number): number {
  const n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function parseTrnsFromMap(parts: string[], colMap: ColMap): ParsedTrns {
  const get = (k: string) => (colMap[k] !== undefined ? (parts[colMap[k]] || '') : '');
  return {
    trnsType: get('TRNSTYPE'), date: get('DATE'), accnt: get('ACCNT'),
    name: get('NAME'), amount: numOr(get('AMOUNT'), 0), docNum: get('DOCNUM'),
    memo: get('MEMO'), terms: get('TERMS'), dueDate: get('DUEDATE'),
    clear: get('CLEAR'), toPrint: get('TOPRINT'), lineItems: [],
  };
}

function parseTrnsPositional(parts: string[]): ParsedTrns {
  return {
    trnsType: parts[1] || '', date: parts[2] || '', accnt: parts[3] || '',
    name: parts[4] || '', amount: parseFloat(parts[5]) || 0, docNum: parts[6] || '',
    memo: parts[7] || '', terms: parts[8] || '', dueDate: parts[9] || '',
    clear: parts[10] || '', toPrint: parts[11] || '', lineItems: [],
  };
}

function parseSplFromMap(parts: string[], colMap: ColMap): ParsedSpl {
  const get = (k: string) => (colMap[k] !== undefined ? (parts[colMap[k]] || '') : '');
  return {
    trnsType: get('TRNSTYPE'), date: get('DATE'), accnt: get('ACCNT'),
    name: get('NAME'), amount: numOr(get('AMOUNT'), 0), docNum: get('DOCNUM'),
    memo: get('MEMO'), qty: numOr(get('QNTY'), 0) || 1, price: numOr(get('PRICE'), 0),
    invItem: get('INVITEM'), clear: get('CLEAR'),
  };
}

function parseSplPositional(parts: string[]): ParsedSpl {
  return {
    trnsType: parts[1] || '', date: parts[2] || '', accnt: parts[3] || '',
    name: parts[4] || '', amount: parseFloat(parts[5]) || 0, docNum: parts[6] || '',
    memo: parts[7] || '', qty: parseFloat(parts[8]) || 1, price: parseFloat(parts[9]) || 0,
    invItem: parts[10] || '', clear: parts[11] || '',
  };
}

/**
 * GAS stax_routeParsedTransaction_ — INVOICE rows with a doc # become
 * invoices; INVOICE rows with a blank doc # become NO_CUSTOMER-style
 * "Blank QB Invoice #" exceptions. The wall-clock timestamp is volatile
 * and not a parity-compare field (the harness compares structure +
 * counts, not the import instant).
 */
function routeParsedTransaction(
  trns: ParsedTrns,
  invoices: ParsedTrns[],
  exceptions: ParsedException[],
  nowTs: string,
): void {
  const type = trns.trnsType.toUpperCase();
  if (type !== 'INVOICE') return;

  if (!trns.docNum || !trns.docNum.trim()) {
    exceptions.push({
      timestamp: nowTs,
      docNum: '',
      name: trns.name,
      staxId: '',
      amount: trns.amount,
      dueDate: trns.dueDate,
      reason: 'Blank QB Invoice # in IIF import',
      link: '',
      resolved: '',
    });
    return;
  }
  invoices.push(trns);
}

/** GAS stax_parseIIF_ — parse IIF content into rows / invoices / exceptions. */
export function staxParseIIF(content: string): ParsedIIF {
  const nowTs = formatDateTimePacific(new Date());
  const lines = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.replace(/[\t ]/g, '').length > 0);

  const rows: string[][] = [];
  const invoices: ParsedTrns[] = [];
  const exceptions: ParsedException[] = [];
  let current: ParsedTrns | null = null;
  let trnsColumns: ColMap | null = null;
  let splColumns: ColMap | null = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].replace(/\s+$/, '');
    const parts = line.split('\t');
    const rowType = parts[0].trim();

    if (rowType === '!TRNS') { trnsColumns = buildColumnMap(parts); continue; }
    if (rowType === '!SPL') { splColumns = buildColumnMap(parts); continue; }
    if (rowType.charAt(0) === '!') continue;

    if (rowType === 'TRNS') {
      current = trnsColumns
        ? parseTrnsFromMap(parts, trnsColumns)
        : parseTrnsPositional(parts);

      const displayRow = parts.slice(0, 12);
      while (displayRow.length < 12) displayRow.push('');
      displayRow[0] = 'TRNS';
      rows.push(displayRow);
    } else if (rowType === 'SPL' && current) {
      const lineItem = splColumns
        ? parseSplFromMap(parts, splColumns)
        : parseSplPositional(parts);
      current.lineItems.push(lineItem);

      const splDisplayRow = parts.slice(0, 12);
      while (splDisplayRow.length < 12) splDisplayRow.push('');
      splDisplayRow[0] = 'SPL';
      rows.push(splDisplayRow);
    } else if (rowType === 'ENDTRNS') {
      if (current) {
        routeParsedTransaction(current, invoices, exceptions, nowTs);
        current = null;
      }
    }
  }

  if (current) {
    routeParsedTransaction(current, invoices, exceptions, nowTs);
  }

  return { rows, invoices, exceptions };
}
