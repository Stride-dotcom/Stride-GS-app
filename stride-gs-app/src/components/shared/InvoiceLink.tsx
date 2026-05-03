/**
 * InvoiceLink.tsx — clickable invoice number that opens the React InvoicePage.
 * Route: /#/invoices/:invoiceNo?client=<spreadsheetId>
 *
 * Used inside table cells on Billing and Payments pages to keep staff inside
 * the React app instead of opening the underlying GS sheet. Stops click-event
 * propagation so it works inside rows that have their own onClick handlers
 * (e.g. Payments rows that open a detail panel).
 *
 * Renders an em-dash placeholder when invoiceNo is empty so callers can use
 * this directly without their own conditional.
 */
import { Link } from 'react-router-dom';
import { theme } from '../../styles/theme';

interface Props {
  invoiceNo: string | null | undefined;
  clientSheetId?: string | null;
  /** Use 700-weight (for the invoice-grouped table where the # is the row identity). */
  bold?: boolean;
  /** What to render when invoiceNo is empty. Defaults to an em-dash. */
  emptyText?: string;
  /** Override font size; default 12px to match table cells. */
  fontSize?: number;
}

export function InvoiceLink({
  invoiceNo,
  clientSheetId,
  bold = false,
  emptyText = '—',
  fontSize = 12,
}: Props) {
  const inv = String(invoiceNo || '').trim();
  if (!inv) {
    return (
      <span style={{ fontSize, color: theme.colors.textMuted }}>{emptyText}</span>
    );
  }
  const sid = String(clientSheetId || '').trim();
  const qs = sid ? `?client=${encodeURIComponent(sid)}` : '';
  return (
    <Link
      to={`/invoices/${encodeURIComponent(inv)}${qs}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        fontSize,
        fontWeight: bold ? 700 : 600,
        color: theme.colors.orange,
        textDecoration: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = 'underline';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = 'none';
      }}
      title={`Open invoice ${inv}`}
    >
      {inv}
    </Link>
  );
}
