/**
 * parseScanPayload.ts — Normalize scanner input into { type, code }.
 *
 * Ported/slimmed from Stride WMS (session 68). The GS labels encode:
 *   • `ITEM:<itemId>` for item labels
 *   • `LOC:<code>` for location labels
 *
 * Also tolerates:
 *   • Plain codes (USB scanners often emit just the raw value)
 *   • Legacy WMS JSON payloads `{"type":"item","code":"62243"}` — in case
 *     someone scans a printed label from the WMS app during migration.
 *   • Deep-link URLs (e.g. https://mystridehub.com/#/scan/item/62243) for
 *     forward-compat with any future QR deep-linking.
 */
export type ScanEntityType = 'item' | 'location' | 'unknown';

export interface ParsedScanPayload {
  type: ScanEntityType;
  code: string;             // The bare item ID or location code
  raw: string;              // Original input
  source: 'prefix' | 'json' | 'url' | 'raw';
}

function trim(input: string): string {
  return (input ?? '').trim();
}

function stripPrefix(code: string): { type: ScanEntityType; code: string; hit: boolean } {
  const upper = code.toUpperCase();
  if (upper.startsWith('ITEM:')) return { type: 'item', code: code.slice(5).trim(), hit: true };
  if (upper.startsWith('LOC:'))  return { type: 'location', code: code.slice(4).trim(), hit: true };
  return { type: 'unknown', code, hit: false };
}

function parseJsonPayload(raw: string): ParsedScanPayload | null {
  if (!raw || (raw[0] !== '{' && raw[0] !== '[' && raw[0] !== '"')) return null;
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === 'string') {
      return { type: 'unknown', code: trim(obj), raw, source: 'json' };
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const t = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
      const type: ScanEntityType =
        t === 'item' ? 'item' :
        t === 'location' ? 'location' :
        'unknown';
      const code = typeof obj.code === 'string' ? obj.code
        : typeof obj.item_code === 'string' ? obj.item_code
        : typeof obj.location_code === 'string' ? obj.location_code
        : typeof obj.id === 'string' ? obj.id
        : '';
      if (code) return { type, code: trim(code), raw, source: 'json' };
    }
  } catch {
    /* not json */
  }
  return null;
}

function parseUrlPayload(raw: string): ParsedScanPayload | null {
  if (!/^(https?:\/\/|\/)/i.test(raw)) return null;
  try {
    const url = raw.startsWith('http')
      ? new URL(raw)
      : new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    // Support both /#/scan/item/CODE (HashRouter) and /scan/item/CODE
    const hashSegments = url.hash.replace(/^#\//, '').split('/').filter(Boolean);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const segs = hashSegments.length >= 2 ? hashSegments : pathSegments;
    if (segs.length >= 3 && segs[0] === 'scan') {
      const entity = segs[1].toLowerCase();
      const codeOrId = decodeURIComponent(segs[2]);
      if (entity === 'item')     return { type: 'item',     code: codeOrId, raw, source: 'url' };
      if (entity === 'location') return { type: 'location', code: codeOrId, raw, source: 'url' };
    }
  } catch {
    /* not a valid url */
  }
  return null;
}

/** Parse a raw scanner payload. Always returns a result (falls back to raw). */
export function parseScanPayload(input: string): ParsedScanPayload {
  const raw = trim(input);
  if (!raw) return { type: 'unknown', code: '', raw, source: 'raw' };

  // 1. URLs / deep links
  const url = parseUrlPayload(raw);
  if (url) return url;

  // 2. JSON payloads (WMS legacy labels)
  const json = parseJsonPayload(raw);
  if (json) return json;

  // 3. Prefixed codes (GS native labels)
  const { type, code, hit } = stripPrefix(raw);
  if (hit) return { type, code, raw, source: 'prefix' };

  // 4. Fallback: raw code with no type hint
  return { type: 'unknown', code: raw.toUpperCase(), raw, source: 'raw' };
}
