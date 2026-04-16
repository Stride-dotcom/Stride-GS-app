import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type MatchTier = 'tier_1' | 'tier_2' | 'tier_3' | 'unknown_account' | 'no_match';

export type CandidateMatchPointKey =
  | 'tracking'
  | 'reference'
  | 'sku'
  | 'vendor'
  | 'description'
  | 'shipper'
  | 'carrier'
  | 'pieces'
  | 'account';

export interface CandidateMatchPoint {
  key: CandidateMatchPointKey;
  label: string;
  value: string;
  priority: number;
}

export interface InboundCandidate {
  shipment_id: string;
  inbound_kind: string;
  account_id: string | null;
  account_name: string | null;
  vendor_name: string | null;
  expected_pieces: number | null;
  eta_start: string | null;
  eta_end: string | null;
  created_at: string;
  shipment_number: string;
  confidence_score: number;
  confidence_label: string;
  /** Structured tier classification from RPC */
  match_tier: MatchTier;
  /** Number of shipment_items matching the item-level search (0 if no item search) */
  item_match_count: number;
  /** Match-point details used for ranking + UI explanation */
  match_points?: CandidateMatchPoint[];
  /** Lower number = higher ranking priority */
  match_priority?: number;
}

export interface CandidateParams {
  accountId?: string | null;
  vendorName?: string | null;
  refValue?: string | null;
  trackingNumber?: string | null;
  referenceNumber?: string | null;
  itemSku?: string | null;
  shipper?: string | null;
  pieces?: number | null;
  /** Item-level description search — refines candidates in Stage 2 */
  itemDescription?: string | null;
  /** Item-level vendor search — refines candidates in Stage 2 */
  itemVendor?: string | null;
}

/** Locked debounce delay for candidate search — do not change without Phase review */
const CANDIDATE_DEBOUNCE_MS = 300;

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function looseMatch(needleRaw: string | null | undefined, haystackRaw: string | null | undefined): boolean {
  const needle = norm(needleRaw);
  const haystack = norm(haystackRaw);
  if (!needle || !haystack) return false;
  return haystack.includes(needle) || needle.includes(haystack);
}

export function useInboundCandidates(params: CandidateParams) {
  const [candidates, setCandidates] = useState<InboundCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const fetchCandidates = useCallback(async () => {
    // Require at least one search signal — avoids a noisy zero-filter query.
    const hasSignal =
      params.accountId ||
      params.trackingNumber ||
      params.referenceNumber ||
      params.refValue ||
      params.shipper ||
      params.vendorName;

    if (!hasSignal) {
      setCandidates([]);
      return;
    }

    // Cancel in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    try {
      setLoading(true);
      setError(null);
      const rpcParams: Record<string, unknown> = {};
      if (params.accountId) rpcParams.p_account_id = params.accountId;
      if (params.vendorName) rpcParams.p_vendor_name = params.vendorName;
      else if (params.shipper) rpcParams.p_vendor_name = params.shipper;
      if (params.referenceNumber || params.refValue) {
        rpcParams.p_ref_value = params.referenceNumber || params.refValue;
      }
      if (params.trackingNumber) rpcParams.p_tracking_number = params.trackingNumber;
      if (params.shipper) rpcParams.p_carrier = params.shipper;
      if (params.pieces) rpcParams.p_pieces = params.pieces;

      const { data, error } = await supabase.rpc(
        'rpc_find_inbound_candidates',
        rpcParams as { p_account_id?: string; p_vendor_name?: string; p_ref_value?: string; p_pieces?: number; p_tracking_number?: string; p_carrier?: string },
      );
      if (error) throw error;

      let results = ((data as unknown as InboundCandidate[]) || []).map((c) => ({
        ...c,
        match_tier: c.match_tier || ('no_match' as MatchTier),
        item_match_count: 0,
      }));

      // Tenant isolation is enforced by the RPC (WHERE s.tenant_id = v_tenant_id).
      // Cross-account candidates within the same tenant are valid matches
      // (e.g. Tier 1 exact ref match with score 95, or unknown_account tier).

      // Item-level refinement: boost candidates that have matching shipment_items
      const hasItemSearch =
        (params.itemDescription && params.itemDescription.trim().length >= 2) ||
        (params.itemVendor && params.itemVendor.trim().length >= 2);

      if (hasItemSearch && results.length > 0) {
        const candidateIds = results.map((c) => c.shipment_id);

        // Build filter conditions for shipment_items
        let query = (supabase as any)
          .from('shipment_items')
          .select('shipment_id')
          .in('shipment_id', candidateIds);

        // Build OR filter for description + vendor
        const orFilters: string[] = [];
        if (params.itemDescription && params.itemDescription.trim().length >= 2) {
          orFilters.push(`expected_description.ilike.%${params.itemDescription.trim()}%`);
        }
        if (params.itemVendor && params.itemVendor.trim().length >= 2) {
          orFilters.push(`expected_vendor.ilike.%${params.itemVendor.trim()}%`);
        }
        if (orFilters.length > 0) {
          query = query.or(orFilters.join(','));
        }

        const { data: itemMatches } = await query;

        if (itemMatches && itemMatches.length > 0) {
          // Count matches per shipment
          const matchCounts = new Map<string, number>();
          for (const row of itemMatches as { shipment_id: string }[]) {
            matchCounts.set(row.shipment_id, (matchCounts.get(row.shipment_id) || 0) + 1);
          }

          // Boost confidence for candidates with item matches
          results = results.map((c) => {
            const count = matchCounts.get(c.shipment_id) || 0;
            if (count > 0) {
              const boost = Math.min(count * 5, 15); // 5 per match, max +15
              return {
                ...c,
                confidence_score: Math.min(c.confidence_score + boost, 100),
                confidence_label:
                  c.confidence_label === 'Possible Match' && boost >= 10
                    ? 'Item Match'
                    : c.confidence_label,
                item_match_count: count,
              };
            }
            return c;
          });

          // Re-sort by confidence descending
          results.sort((a, b) => b.confidence_score - a.confidence_score);
        }
      }

      // Priority order for match point display
      const FIELD_PRIORITY: Record<string, number> = {
        tracking: 1, reference: 2, sku: 3, vendor: 4, carrier: 5,
        description: 6, shipper: 6, pieces: 7, account: 8,
      };
      const FIELD_LABELS: Record<string, string> = {
        tracking: 'Tracking', reference: 'Reference', sku: 'SKU',
        vendor: 'Vendor', carrier: 'Carrier', description: 'Description',
        shipper: 'Shipper', pieces: 'Pieces', account: 'Account',
      };

      const buildMatchPoints = (candidate: InboundCandidate): CandidateMatchPoint[] => {
        const source = candidate as unknown as Record<string, unknown>;

        // Prefer RPC-provided match_details when available
        const rpcDetails = source.match_details as Array<{ field: string; points: number; matched_value: string }> | null;
        if (rpcDetails && Array.isArray(rpcDetails) && rpcDetails.length > 0) {
          return rpcDetails.map((d) => ({
            key: (d.field === 'carrier' ? 'shipper' : d.field) as CandidateMatchPointKey,
            label: FIELD_LABELS[d.field] || d.field,
            value: d.matched_value || '',
            priority: FIELD_PRIORITY[d.field] || 99,
          }));
        }

        // Fallback: client-side match point detection
        const points: CandidateMatchPoint[] = [];
        const trackingValue = String(source.tracking_number ?? '').trim();
        const referenceValue = String(source.reference_number ?? source.po_number ?? source.ref_value ?? '').trim();
        const vendorValue = String(candidate.vendor_name ?? source.expected_vendor ?? '').trim();
        const shipperValue = String(source.shipper ?? source.carrier ?? '').trim();

        const trackingInput = params.trackingNumber || null;
        const referenceInput = params.referenceNumber || params.refValue || null;
        const vendorInput = params.itemVendor || params.vendorName || null;
        const shipperInput = params.shipper || null;

        if (trackingInput && looseMatch(trackingInput, trackingValue)) {
          points.push({ key: 'tracking', label: 'Tracking', value: trackingValue || String(trackingInput), priority: 1 });
        }
        if (referenceInput && looseMatch(referenceInput, referenceValue)) {
          points.push({ key: 'reference', label: 'Reference', value: referenceValue || String(referenceInput), priority: 2 });
        }
        if (vendorInput && looseMatch(vendorInput, vendorValue)) {
          points.push({ key: 'vendor', label: 'Vendor', value: vendorValue || String(vendorInput), priority: 4 });
        }
        if (shipperInput && looseMatch(shipperInput, shipperValue)) {
          points.push({ key: 'shipper', label: 'Shipper', value: shipperValue || String(shipperInput), priority: 6 });
        }

        return points;
      };

      results = results
        .map((candidate) => {
          const matchPoints = buildMatchPoints(candidate);
          const bestPriority = matchPoints.length > 0
            ? Math.min(...matchPoints.map((p) => p.priority))
            : 99;
          return {
            ...candidate,
            match_points: matchPoints,
            match_priority: bestPriority,
          };
        })
        .sort((a, b) => {
          const byPriority = (a.match_priority ?? 99) - (b.match_priority ?? 99);
          if (byPriority !== 0) return byPriority;
          if ((b.match_points?.length || 0) !== (a.match_points?.length || 0)) {
            return (b.match_points?.length || 0) - (a.match_points?.length || 0);
          }
          return b.confidence_score - a.confidence_score;
        });

      setCandidates(results);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error fetching candidates:', message, err);
      setError(message);
      // Silently log — no user-facing toast for matching failures.
    } finally {
      setLoading(false);
    }
  }, [
    params.accountId,
    params.vendorName,
    params.refValue,
    params.trackingNumber,
    params.referenceNumber,
    params.itemSku,
    params.shipper,
    params.pieces,
    params.itemDescription,
    params.itemVendor,
  ]);

  // Debounced search — cancelable on parameter change
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      fetchCandidates();
    }, CANDIDATE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchCandidates]);

  return { candidates, loading, error, refetch: fetchCandidates };
}
