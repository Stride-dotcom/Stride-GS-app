/**
 * dt-description-merge — read-before-write merge for the DispatchTrack
 * order <description> ("Order Details") block. v1 2026-06-05 PST
 *
 * Foundational infrastructure for the COD-storage feature. DT's add_order
 * API is a full-replace upsert: any <description> we push REPLACES DT's
 * current description wholesale, wiping notes the dispatch team typed
 * directly in DT (COD-paid notes, "customer not home", payment receipts).
 *
 * v37 of dt-push-order worked around this by making the description
 * dispatcher-owned after the initial push — it simply stopped emitting
 * <description> on re-pushes. That preserved dispatcher notes but meant
 * Stride could never update its own billing / COD summary after create.
 *
 * This module enables a smarter contract: Stride owns ONE clearly-marked
 * section of the description; the dispatcher owns everything else.
 *
 *   <dispatcher free text, payment notes, etc.>
 *   --- STRIDE APP (2026-06-05 14:32 PT) ---
 *   <Stride-generated billing / COD / delivery summary>
 *   --- END STRIDE APP ---
 *   <more dispatcher free text>
 *
 * On a re-push the caller:
 *   1. reads DT's CURRENT description via the export.xml API
 *      (fetchDtOrderDescription)
 *   2. replaces ONLY the STRIDE APP section with fresh content, leaving
 *      every dispatcher-authored line outside the markers untouched
 *      (mergeStrideAppSection)
 *   3. pushes the merged string back through add_order
 *
 * If the export read fails, the caller falls back to pushing the
 * STRIDE-APP-only section (see dt-push-order) — it never blocks the push.
 */

import { DOMParser } from 'https://esm.sh/@xmldom/xmldom@0.9.8';

// ── Markers ──────────────────────────────────────────────────────────────
const STRIDE_START = '--- STRIDE APP';
const STRIDE_END = '--- END STRIDE APP ---';

// Matches a whole STRIDE APP section: the opening "--- STRIDE APP (...) ---"
// marker, its body, and the closing "--- END STRIDE APP ---" marker. The
// timestamp inside the opening marker is irrelevant to the match (any text
// up to the first END marker is consumed non-greedily). Leading/trailing
// horizontal whitespace on the marker lines is absorbed so an indented
// section is replaced cleanly. Global flag so duplicates can be collapsed.
//
// `-{3,}` (3+ dashes) is tolerant of a dispatcher who trimmed or padded the
// dashes; the START anchor still requires the literal "STRIDE APP" token so
// it can't match an unrelated "--- ... ---" divider.
const STRIDE_SECTION_RE =
  /[ \t]*-{3,}\s*STRIDE APP\b[\s\S]*?-{3,}\s*END STRIDE APP\s*-{3,}[ \t]*/g;

// ── DT export read ─────────────────────────────────────────────────────────

export interface DtExportLookup {
  /** DT API base, e.g. https://expressinstallation.dispatchtrack.com */
  baseUrl: string;
  /** DT api_key (dt_credentials.auth_token_encrypted). */
  apiKey: string;
  /** Order_Number (dt_identifier) — DT's export `service_order_id` param
   *  accepts the human Order_Number per the XML API spec (same lookup
   *  dt-sync-statuses uses). */
  lookupId: string;
  /** DT account code; defaults to 'expressinstallation' (the only code in
   *  use — same hardcode as dt-push-order's add_order URL). */
  code?: string;
  /** Abort the fetch after this many ms. Default 10s. */
  timeoutMs?: number;
}

/**
 * Read the current order-level <description> ("Order Details") of a DT
 * order via the export.xml API.
 *
 * Returns:
 *   • the raw description text (entity-decoded, CDATA-flattened, trimmed)
 *   • '' when the order exists but carries no description yet
 *   • null on ANY failure — network error, timeout, non-200, unparseable
 *     body, or missing <service_order>. Callers MUST treat null as
 *     "export unavailable → fall back", never as "DT description is empty".
 *
 * Uses a DOM parser and reads ONLY a direct child <description> of
 * <service_order>, so a nested item / history-event <description> can
 * never be mistaken for the order-level one.
 */
export async function fetchDtOrderDescription(opts: DtExportLookup): Promise<string | null> {
  const code = opts.code ?? 'expressinstallation';
  const base = (opts.baseUrl || '').replace(/\/+$/, '');
  const lookupId = (opts.lookupId || '').trim();
  if (!base || !opts.apiKey || !lookupId) {
    console.warn('[dt-description-merge] export read skipped — missing baseUrl/apiKey/lookupId');
    return null;
  }

  const url = `${base}/orders/api/export.xml?code=${encodeURIComponent(code)}` +
    `&api_key=${encodeURIComponent(opts.apiKey)}` +
    `&service_order_id=${encodeURIComponent(lookupId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    // POST + Accept:application/xml mirrors dt-sync-statuses' proven call.
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/xml' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[dt-description-merge] export.xml HTTP ${resp.status} for ${lookupId}`);
      return null;
    }
    const xml = await resp.text();
    return extractOrderDescription(xml);
  } catch (err) {
    console.warn(`[dt-description-merge] export.xml fetch failed for ${lookupId}: ${(err as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the order-level <description> out of a DT export.xml body.
 * Exported for unit-testing the parse step without a network round-trip.
 * Returns '' when the order has no description, null when the body has no
 * parseable <service_order>.
 */
export function extractOrderDescription(xml: string): string | null {
  let order;
  try {
    // Same xmldom pattern dt-backfill-orders uses (proven in deploy).
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    order = doc.getElementsByTagName('service_order')[0];
  } catch (err) {
    console.warn(`[dt-description-merge] export.xml parse failed: ${(err as Error).message}`);
    return null;
  }
  if (!order) return null;

  // Direct-child <description> only. getElementsByTagName would also match
  // nested <item>/<history> descriptions (and return them in document
  // order), so we walk the immediate children instead — unambiguous
  // regardless of DT's element ordering.
  const kids = order.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (node && node.nodeType === 1 /* ELEMENT_NODE */ && node.nodeName === 'description') {
      return (node.textContent || '').replace(/\r\n/g, '\n').trim();
    }
  }
  // Order exists but has no description element — nothing to preserve.
  return '';
}

// ── Merge ──────────────────────────────────────────────────────────────────

/**
 * Build a single STRIDE APP section from app-owned content + a timestamp.
 * `appContent` is raw text (NOT XML/CDATA-escaped) — escaping happens at
 * the <description> emit site in the caller.
 */
export function buildStrideAppSection(appContent: string, timestamp: string): string {
  const body = (appContent ?? '').replace(/\r\n/g, '\n').trim();
  return `${STRIDE_START} (${timestamp}) ---\n${body}\n${STRIDE_END}`;
}

/**
 * Merge fresh Stride content into a DT description, replacing ONLY the
 * STRIDE APP section and preserving every dispatcher-authored line
 * outside the markers.
 *
 *   • An existing STRIDE APP section is replaced in place (its surrounding
 *     dispatcher text keeps its position). Any *additional* STRIDE APP
 *     sections — which should never exist, but guard against historical
 *     accumulation — are stripped so only one remains.
 *   • If no STRIDE APP section exists (first push, or a dispatcher-only
 *     description), the fresh section is appended at the end after a blank
 *     line so it sits below the dispatcher's notes.
 *
 * Pure string operation; no XML escaping (the caller wraps the result in
 * <![CDATA[...]]> on emit).
 */
export function mergeStrideAppSection(
  currentDescription: string | null,
  appContent: string,
  timestamp: string,
): string {
  const current = (currentDescription ?? '').replace(/\r\n/g, '\n');
  const section = buildStrideAppSection(appContent, timestamp);

  let found = false;
  let replaced = false;
  const re = new RegExp(STRIDE_SECTION_RE.source, 'g');
  const merged = current.replace(re, () => {
    found = true;
    if (!replaced) {
      replaced = true;
      return section; // replace the first section in place
    }
    return ''; // drop any duplicate STRIDE APP sections
  });

  if (found) return tidy(merged);

  // No existing section — append below dispatcher content.
  const head = current.replace(/\s+$/, '');
  return head ? `${head}\n\n${section}` : section;
}

// Collapse the blank-line runs that removing a duplicate section can leave
// behind (3+ newlines → one blank line), strip trailing spaces on a line,
// and trim leading/trailing whitespace of the whole block. Single blank-line
// separators a dispatcher placed intentionally are preserved.
function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
}

// ── Timestamp ──────────────────────────────────────────────────────────────

/**
 * Format a Date as "YYYY-MM-DD HH:MM PT" in America/Los_Angeles so the
 * STRIDE APP marker timestamp matches the rest of the system's PST/PT
 * convention. Falls back to a UTC stamp if Intl is unavailable.
 */
export function formatStrideTimestamp(date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} PT`;
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}
