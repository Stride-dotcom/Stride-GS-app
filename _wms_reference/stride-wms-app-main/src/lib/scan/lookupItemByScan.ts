import { supabase } from '@/integrations/supabase/client';
import { isValidUuid } from '@/lib/utils';
import { parseScanPayload } from '@/lib/scan/parseScanPayload';

export interface LookupItemByScanResult {
  id: string;
  item_code: string;
  description: string | null;
  current_location_code: string | null;
  warehouse_name: string | null;
}

interface LookupItemByScanOptions {
  tenantId?: string | null;
}

function escapeIlikeLiteral(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

/**
 * Shared item scanner lookup used by scan flows that accept item barcodes/QRs.
 * Behavior mirrors the proven Move flow:
 * - reject explicit location/container payloads
 * - try UUID id first (when scan value looks like a UUID)
 * - fallback to exact item_code matching (case-insensitive, escaped)
 */
export async function lookupItemByScan(
  input: string,
  options?: LookupItemByScanOptions,
): Promise<LookupItemByScanResult | null> {
  const payload = parseScanPayload(input);
  if (!payload) return null;
  if (payload.type === 'location' || payload.type === 'container') return null;

  const raw = input.trim();
  const codeCandidate = (payload.code || payload.id || raw).trim();
  const idCandidate =
    (payload.type === 'item' && payload.id && isValidUuid(payload.id))
      ? payload.id
      : (codeCandidate && isValidUuid(codeCandidate))
        ? codeCandidate
        : null;

  const buildBaseQuery = () => {
    let query = supabase
      .from('v_items_with_location')
      .select('id, item_code, description, location_code, warehouse_name')
      .is('deleted_at', null);

    if (options?.tenantId) {
      query = query.eq('tenant_id', options.tenantId);
    }

    return query;
  };

  const mapRow = (row: any): LookupItemByScanResult => ({
    id: row.id,
    item_code: row.item_code,
    description: row.description,
    current_location_code: row.location_code || null,
    warehouse_name: row.warehouse_name || null,
  });

  if (idCandidate) {
    const { data, error } = await buildBaseQuery().eq('id', idCandidate).maybeSingle();
    if (!error && data) {
      return mapRow(data);
    }
  }

  if (!codeCandidate) return null;

  const normalizedCandidates = Array.from(
    new Set([
      codeCandidate,
      codeCandidate.replace(/[_\s]+/g, '-'),
    ]),
  )
    .map((c) => c.trim())
    .filter(Boolean);

  // Fast path: exact matching first (index-friendly).
  const exactCandidates = Array.from(
    new Set(
      normalizedCandidates
        .flatMap((c) => [c, c.toUpperCase()])
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  );

  if (exactCandidates.length > 0) {
    const { data, error } = await buildBaseQuery()
      .in('item_code', exactCandidates)
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      return mapRow(data);
    }
  }

  // Fallback: one case-insensitive pass for the raw code candidate.
  // Keeping this as a single query avoids sequential retries.
  const { data: ciData, error: ciError } = await buildBaseQuery()
    .ilike('item_code', escapeIlikeLiteral(codeCandidate))
    .limit(1)
    .maybeSingle();
  if (!ciError && ciData) {
    return mapRow(ciData);
  }

  return null;
}

