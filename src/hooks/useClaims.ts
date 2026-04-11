/**
 * useClaims — Fetches claims from the Stride API (CB Claims tab).
 *
 * Maps API data to the app's Claim type.
 *
 * Phase 2C: optimistic patch architecture.
 * - applyClaimPatch: replace patch for a claim (status changes, atomic ops)
 * - mergeClaimPatch: accumulate fields into patch (multi-field edits)
 * - clearClaimPatch: remove patch, server data takes over
 * - addOptimisticClaim / removeOptimisticClaim: temp claims for create ops
 * Patches auto-expire after 120s (guarded in useMemo merge).
 */
import { useCallback, useMemo, useState } from 'react';
import { fetchClaims } from '../lib/api';
import type { ApiClaim, ClaimsResponse } from '../lib/api';
import type { Claim, ClaimType, ClaimStatus } from '../lib/types';
import { useApiData } from './useApiData';

export interface UseClaimsResult {
  /** Raw API claims */
  apiClaims: ApiClaim[];
  /** Mapped claims for UI */
  claims: Claim[];
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  // Phase 2C — optimistic patch functions
  applyClaimPatch: (claimId: string, patch: Partial<Claim>) => void;
  mergeClaimPatch: (claimId: string, patch: Partial<Claim>) => void;
  clearClaimPatch: (claimId: string) => void;
  addOptimisticClaim: (claim: Claim) => void;
  removeOptimisticClaim: (tempClaimId: string) => void;
}

const VALID_TYPES: ClaimType[] = ['Item Claim', 'Property Claim'];

const VALID_STATUSES: ClaimStatus[] = [
  'Under Review', 'Waiting on Info', 'Settlement Sent', 'Approved', 'Closed', 'Void',
];

const PATCH_TTL_MS = 120_000; // 120 seconds

function mapToAppClaim(api: ApiClaim): Claim {
  const claimType = VALID_TYPES.includes(api.claimType as ClaimType)
    ? (api.claimType as ClaimType)
    : 'Item Claim';

  const status = VALID_STATUSES.includes(api.status as ClaimStatus)
    ? (api.status as ClaimStatus)
    : 'Under Review';

  return {
    claimId: api.claimId,
    claimType,
    status,
    outcomeType: api.outcomeType || undefined,
    resolutionType: api.resolutionType || undefined,
    dateOpened: api.dateOpened,
    incidentDate: api.incidentDate || undefined,
    dateClosed: api.dateClosed || undefined,
    dateSettlementSent: api.dateSettlementSent || undefined,
    dateSignedSettlementReceived: api.dateSignedSettlementReceived || undefined,
    createdBy: api.createdBy || undefined,
    firstReviewedBy: api.firstReviewedBy || undefined,
    firstReviewedAt: api.firstReviewedAt || undefined,
    primaryContactName: api.primaryContactName || undefined,
    companyClientName: api.companyClientName,
    email: api.email || undefined,
    phone: api.phone || undefined,
    requestedAmount: api.requestedAmount ?? undefined,
    approvedAmount: api.approvedAmount ?? undefined,
    coverageType: api.coverageType || undefined,
    clientSelectedCoverage: api.clientSelectedCoverage || undefined,
    propertyIncidentReference: api.propertyIncidentReference || undefined,
    incidentLocation: api.incidentLocation || undefined,
    issueDescription: api.issueDescription || undefined,
    decisionExplanation: api.decisionExplanation || undefined,
    internalNotesSummary: api.internalNotesSummary || undefined,
    publicNotesSummary: api.publicNotesSummary || undefined,
    claimFolderUrl: api.claimFolderUrl || undefined,
    currentSettlementFileUrl: api.currentSettlementFileUrl || undefined,
    currentSettlementVersion: api.currentSettlementVersion || undefined,
    voidReason: api.voidReason || undefined,
    closeNote: api.closeNote || undefined,
    lastUpdated: api.lastUpdated || undefined,
  };
}

export function useClaims(autoFetch = true): UseClaimsResult {
  const fetchFn = useCallback(
    (signal?: AbortSignal) => fetchClaims(signal),
    []
  );

  const { data, loading, error, refetch, lastFetched } = useApiData<ClaimsResponse>(
    fetchFn,
    autoFetch,
    'claims'
  );

  // ─── Phase 2C: Optimistic patch state ────────────────────────────────────
  const [patches, setPatches] = useState<Record<string, { data: Partial<Claim>; appliedAt: number }>>({});
  const [optimisticCreates, setOptimisticCreates] = useState<Claim[]>([]);

  const applyClaimPatch = useCallback((claimId: string, patch: Partial<Claim>) => {
    setPatches(prev => ({ ...prev, [claimId]: { data: patch, appliedAt: Date.now() } }));
  }, []);

  const mergeClaimPatch = useCallback((claimId: string, patch: Partial<Claim>) => {
    setPatches(prev => ({
      ...prev,
      [claimId]: {
        data: { ...(prev[claimId]?.data ?? {}), ...patch },
        appliedAt: Date.now(),
      },
    }));
  }, []);

  const clearClaimPatch = useCallback((claimId: string) => {
    setPatches(prev => {
      const next = { ...prev };
      delete next[claimId];
      return next;
    });
  }, []);

  const addOptimisticClaim = useCallback((claim: Claim) => {
    setOptimisticCreates(prev => [claim, ...prev]);
  }, []);

  const removeOptimisticClaim = useCallback((tempClaimId: string) => {
    setOptimisticCreates(prev => prev.filter(c => c.claimId !== tempClaimId));
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Note: Claims does not participate in Supabase Realtime (no supabase table).
  // Patches are cleared manually by the caller after API success/failure.

  // Stabilize empty array reference to prevent re-render cascades
  const apiClaims = useMemo(() => data?.claims ?? [], [data]);

  // Phase 2C: merge patches into raw mapped claims, then prepend optimistic creates
  const claims = useMemo(() => {
    const now = Date.now();
    const rawClaims = apiClaims.map(mapToAppClaim);
    const merged = rawClaims.map(c => {
      const p = patches[c.claimId];
      if (!p || now - p.appliedAt > PATCH_TTL_MS) return c;
      return { ...c, ...p.data };
    });
    return [...optimisticCreates, ...merged];
  }, [apiClaims, patches, optimisticCreates]);

  return {
    apiClaims,
    claims,
    count: data?.count ?? 0,
    loading,
    error,
    refetch,
    lastFetched,
    applyClaimPatch,
    mergeClaimPatch,
    clearClaimPatch,
    addOptimisticClaim,
    removeOptimisticClaim,
  };
}
