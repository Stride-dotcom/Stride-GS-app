import { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import {
  useInboundCandidates,
  type CandidateMatchPoint,
  type CandidateParams,
  type InboundCandidate,
  type MatchTier,
} from '@/hooks/useInboundCandidates';
import { useInboundLinks, type InboundLink } from '@/hooks/useInboundLinks';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DockIntakeMatchingPanelProps {
  dockIntakeId: string;
  params: CandidateParams;
  onLinked?: () => void;
  /** When true, shows item-level refinement hints */
  showItemRefinement?: boolean;
}

type CandidateItemRow = {
  id: string;
  expected_quantity: number;
  expected_vendor: string | null;
  expected_description: string | null;
  expected_sidemark: string | null;
  room: string | null;
  item?: {
    item_code: string | null;
  } | null;
};

type CandidateShipmentDetail = {
  id: string;
  shipment_number: string;
  inbound_kind: string | null;
  account_id: string | null;
  account_name: string | null;
  vendor_name: string | null;
  expected_pieces: number | null;
  eta_start: string | null;
  eta_end: string | null;
  carrier: string | null;
  tracking_number: string | null;
  po_number: string | null;
};

function confidenceBadgeVariant(score: number): 'default' | 'secondary' | 'outline' {
  if (score >= 80) return 'default';
  if (score >= 50) return 'secondary';
  return 'outline';
}

function tierLabel(tier: MatchTier): string {
  switch (tier) {
    case 'tier_1': return 'T1';
    case 'tier_2': return 'T2';
    case 'tier_3': return 'T3';
    case 'unknown_account': return 'XA';
    case 'no_match': return '—';
  }
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function includesMatch(input: string | null | undefined, candidateValue: string | null | undefined): boolean {
  const a = norm(input);
  const b = norm(candidateValue);
  if (!a || !b) return false;
  return b.includes(a) || a.includes(b);
}

function buildShipmentDetailPath(inboundKind: string | null | undefined, shipmentId: string): string {
  if ((inboundKind || '').toLowerCase() === 'expected') {
    return `/incoming/expected/${shipmentId}`;
  }
  return `/shipments/${shipmentId}`;
}

function mergeMatchPoints(
  basePoints: CandidateMatchPoint[] | undefined,
  params: CandidateParams,
  details: CandidateShipmentDetail | null | undefined,
  items: CandidateItemRow[]
): CandidateMatchPoint[] {
  const pointsByKey = new Map<string, CandidateMatchPoint>();
  const addPoint = (point: CandidateMatchPoint) => {
    const existing = pointsByKey.get(point.key);
    if (!existing || point.priority < existing.priority) {
      pointsByKey.set(point.key, point);
    }
  };

  (basePoints || []).forEach(addPoint);

  if (params.trackingNumber && includesMatch(params.trackingNumber, details?.tracking_number || null)) {
    addPoint({
      key: 'tracking',
      label: 'Tracking',
      value: details?.tracking_number || params.trackingNumber,
      priority: 1,
    });
  }

  const refCandidate = details?.po_number || null;
  if ((params.referenceNumber || params.refValue) && includesMatch(params.referenceNumber || params.refValue, refCandidate)) {
    addPoint({
      key: 'reference',
      label: 'Reference',
      value: refCandidate || params.referenceNumber || params.refValue || '',
      priority: 2,
    });
  }

  if (params.itemSku) {
    const matchedSku = items
      .map((r) => r.item?.item_code || '')
      .find((code) => includesMatch(params.itemSku || null, code));
    if (matchedSku) {
      addPoint({
        key: 'sku',
        label: 'SKU',
        value: matchedSku,
        priority: 3,
      });
    }
  }

  const vendorCandidate = details?.vendor_name || items.find((r) => !!r.expected_vendor)?.expected_vendor || null;
  if ((params.itemVendor || params.vendorName) && includesMatch(params.itemVendor || params.vendorName, vendorCandidate)) {
    addPoint({
      key: 'vendor',
      label: 'Vendor',
      value: vendorCandidate || params.itemVendor || params.vendorName || '',
      priority: 4,
    });
  }

  if (params.itemDescription) {
    const matchedDescription = items
      .map((r) => r.expected_description || '')
      .find((d) => includesMatch(params.itemDescription || null, d));
    if (matchedDescription) {
      addPoint({
        key: 'description',
        label: 'Description',
        value: matchedDescription,
        priority: 5,
      });
    }
  }

  if (params.shipper && includesMatch(params.shipper, details?.carrier || null)) {
    addPoint({
      key: 'shipper',
      label: 'Shipper',
      value: details?.carrier || params.shipper,
      priority: 6,
    });
  }

  return Array.from(pointsByKey.values()).sort((a, b) => a.priority - b.priority);
}

export default function DockIntakeMatchingPanel({
  dockIntakeId,
  params,
  onLinked,
  showItemRefinement,
}: DockIntakeMatchingPanelProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [linking, setLinking] = useState<string | null>(null);
  const [expandedCandidateIds, setExpandedCandidateIds] = useState<Set<string>>(() => new Set());
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set());
  const [detailDialogShipmentId, setDetailDialogShipmentId] = useState<string | null>(null);
  const [detailsByShipmentId, setDetailsByShipmentId] = useState<
    Record<string, { loading: boolean; details: CandidateShipmentDetail | null }>
  >({});
  const [itemsByShipmentId, setItemsByShipmentId] = useState<
    Record<string, { loading: boolean; items: CandidateItemRow[] }>
  >({});

  const { candidates, loading, error: candidateError } = useInboundCandidates(params);
  const { links, loading: linksLoading, unlinkShipment, refetch: refetchLinks } = useInboundLinks(dockIntakeId);

  const linkedIds = new Set(links.map((l) => l.linked_shipment_id));
  const filteredCandidates = candidates.filter((c) => !linkedIds.has(c.shipment_id));

  const filteredById = useMemo(() => {
    return new Map(filteredCandidates.map((c) => [c.shipment_id, c]));
  }, [filteredCandidates]);

  const ensureShipmentLoaded = useCallback(async (shipmentId: string) => {
    if (!shipmentId) return;
    if (detailsByShipmentId[shipmentId]?.loading || itemsByShipmentId[shipmentId]?.loading) return;
    if (detailsByShipmentId[shipmentId]?.details && itemsByShipmentId[shipmentId]?.items) return;

    setDetailsByShipmentId((prev) => ({
      ...prev,
      [shipmentId]: { loading: true, details: prev[shipmentId]?.details || null },
    }));
    setItemsByShipmentId((prev) => ({
      ...prev,
      [shipmentId]: { loading: true, items: prev[shipmentId]?.items || [] },
    }));

    try {
      const [{ data: shipmentData, error: shipmentError }, { data: itemData, error: itemError }] = await Promise.all([
        (supabase as any)
          .from('shipments')
          .select(`
            id,
            shipment_number,
            inbound_kind,
            account_id,
            vendor_name,
            expected_pieces,
            eta_start,
            eta_end,
            carrier,
            tracking_number,
            po_number,
            accounts:account_id(account_name)
          `)
          .eq('id', shipmentId)
          .maybeSingle(),
        (supabase as any)
          .from('shipment_items')
          .select('id, expected_quantity, expected_vendor, expected_description, expected_sidemark, room, item:item_id(item_code)')
          .eq('shipment_id', shipmentId)
          .order('created_at', { ascending: true }),
      ]);

      if (shipmentError) throw shipmentError;
      if (itemError) throw itemError;

      const details: CandidateShipmentDetail | null = shipmentData
        ? {
            id: shipmentData.id,
            shipment_number: shipmentData.shipment_number || '—',
            inbound_kind: shipmentData.inbound_kind || null,
            account_id: shipmentData.account_id || null,
            account_name: shipmentData.accounts?.account_name || null,
            vendor_name: shipmentData.vendor_name || null,
            expected_pieces: shipmentData.expected_pieces || null,
            eta_start: shipmentData.eta_start || null,
            eta_end: shipmentData.eta_end || null,
            carrier: shipmentData.carrier || null,
            tracking_number: shipmentData.tracking_number || null,
            po_number: shipmentData.po_number || null,
          }
        : null;

      setDetailsByShipmentId((prev) => ({
        ...prev,
        [shipmentId]: { loading: false, details },
      }));
      setItemsByShipmentId((prev) => ({
        ...prev,
        [shipmentId]: { loading: false, items: (itemData as CandidateItemRow[]) || [] },
      }));
    } catch (error) {
      console.error('[DockIntakeMatchingPanel] failed to load shipment detail:', error);
      setDetailsByShipmentId((prev) => ({
        ...prev,
        [shipmentId]: { loading: false, details: prev[shipmentId]?.details || null },
      }));
      setItemsByShipmentId((prev) => ({
        ...prev,
        [shipmentId]: { loading: false, items: prev[shipmentId]?.items || [] },
      }));
    }
  }, [detailsByShipmentId, itemsByShipmentId]);

  const toggleExpanded = useCallback((shipmentId: string) => {
    setExpandedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });
    void ensureShipmentLoaded(shipmentId);
  }, [ensureShipmentLoaded]);

  const toggleSelected = useCallback((shipmentId: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });
  }, []);

  const openDetailsDialog = useCallback((shipmentId: string) => {
    setDetailDialogShipmentId(shipmentId);
    void ensureShipmentLoaded(shipmentId);
  }, [ensureShipmentLoaded]);

  const openFullDetails = useCallback((shipmentId: string, inboundKind?: string | null) => {
    navigate(buildShipmentDetailPath(inboundKind, shipmentId));
  }, [navigate]);

  const handleLink = useCallback(
    async (candidate: InboundCandidate) => {
      try {
        setLinking(candidate.shipment_id);
        const { error } = await supabase.rpc('rpc_link_dock_intake_to_shipment', {
          p_dock_intake_id: dockIntakeId,
          p_linked_shipment_id: candidate.shipment_id,
          p_link_type: candidate.inbound_kind,
          p_confidence_score: candidate.confidence_score,
        });
        if (error) throw error;

        toast({
          title: 'Linked',
          description: `Dock intake linked to ${candidate.shipment_number}.`,
        });
        refetchLinks();
        onLinked?.();
      } catch (error) {
        toast({
          variant: 'destructive',
          title: 'Link Failed',
          description: error instanceof Error ? error.message : 'Failed to link.',
        });
      } finally {
        setLinking(null);
      }
    },
    [dockIntakeId, toast, onLinked, refetchLinks]
  );

  const handleLinkSelected = useCallback(async () => {
    const selectedIds = Array.from(selectedCandidateIds);
    const selectedCandidates = selectedIds
      .map((id) => filteredById.get(id))
      .filter(Boolean) as InboundCandidate[];

    if (selectedCandidates.length === 0) return;

    setLinking('bulk');
    try {
      for (const c of selectedCandidates) {
        const { error } = await supabase.rpc('rpc_link_dock_intake_to_shipment', {
          p_dock_intake_id: dockIntakeId,
          p_linked_shipment_id: c.shipment_id,
          p_link_type: c.inbound_kind,
          p_confidence_score: c.confidence_score,
        });
        if (error) throw error;
      }

      toast({
        title: 'Linked',
        description: `Linked ${selectedCandidates.length} shipment${selectedCandidates.length !== 1 ? 's' : ''}.`,
      });
      setSelectedCandidateIds(new Set());
      refetchLinks();
      onLinked?.();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Link Failed',
        description: error instanceof Error ? error.message : 'Failed to link.',
      });
    } finally {
      setLinking(null);
    }
  }, [selectedCandidateIds, filteredById, dockIntakeId, toast, refetchLinks, onLinked]);

  const handleUnlink = useCallback(
    async (link: InboundLink) => {
      await unlinkShipment(link.id);
      onLinked?.();
    },
    [unlinkShipment, onLinked]
  );

  const hasAccount = Boolean(params.accountId);

  const getMatchPointsForShipment = useCallback((shipmentId: string, basePoints?: CandidateMatchPoint[]) => {
    const details = detailsByShipmentId[shipmentId]?.details;
    const items = itemsByShipmentId[shipmentId]?.items || [];
    return mergeMatchPoints(basePoints, params, details, items);
  }, [detailsByShipmentId, itemsByShipmentId, params]);

  const renderMatchPoints = (points: CandidateMatchPoint[]) => {
    if (points.length === 0) {
      return <p className="text-xs text-muted-foreground">No match-point details available.</p>;
    }
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {points.map((point) => (
          <div key={`${point.key}-${point.value}`} className="rounded-md border bg-muted/20 px-2 py-1.5">
            <div className="text-[11px] text-muted-foreground">{point.label}</div>
            <div className="text-xs font-medium truncate">{point.value || '—'}</div>
          </div>
        ))}
      </div>
    );
  };

  const renderItemsPreview = (shipmentId: string) => {
    const rows = itemsByShipmentId[shipmentId]?.items || [];
    const loadingItems = itemsByShipmentId[shipmentId]?.loading;
    if (loadingItems) {
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
          Loading items…
        </div>
      );
    }
    if (rows.length === 0) {
      return <p className="text-xs text-muted-foreground">No items found for this shipment.</p>;
    }
    return (
      <div className="space-y-1.5">
        {rows.slice(0, 6).map((item) => (
          <div key={item.id} className="grid grid-cols-[64px_1fr] gap-2 rounded-md bg-muted/20 p-2">
            <div className="text-xs font-mono text-muted-foreground">
              Qty {item.expected_quantity}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{item.expected_description || 'No description'}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {item.item?.item_code ? `SKU: ${item.item.item_code}` : 'SKU: —'}
                {item.expected_vendor ? ` · Vendor: ${item.expected_vendor}` : ''}
                {item.expected_sidemark ? ` · Sidemark: ${item.expected_sidemark}` : ''}
                {item.room ? ` · Room: ${item.room}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const dialogDetails = detailDialogShipmentId ? detailsByShipmentId[detailDialogShipmentId]?.details : null;
  const dialogCandidate = detailDialogShipmentId ? filteredById.get(detailDialogShipmentId) : undefined;
  const dialogPoints = detailDialogShipmentId
    ? getMatchPointsForShipment(detailDialogShipmentId, dialogCandidate?.match_points)
    : [];

  return (
    <div className="space-y-4">
      {/* Linked Shipments */}
      {links.length > 0 && (
        <Card className="border-green-200 bg-green-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-green-800">
              <MaterialIcon name="link" size="sm" />
              Linked ({links.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {linksLoading ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading linked shipments…
              </div>
            ) : null}
            {links.map((link) => {
              const points = getMatchPointsForShipment(link.linked_shipment_id);
              return (
                <Collapsible
                  key={link.id}
                  open={expandedCandidateIds.has(link.linked_shipment_id)}
                  onOpenChange={() => toggleExpanded(link.linked_shipment_id)}
                >
                  <div className="rounded-md border border-green-200 bg-white">
                    <div className="flex items-start justify-between gap-2 p-3">
                      <button
                        type="button"
                        className="flex-1 min-w-0 text-left"
                        onClick={() => openDetailsDialog(link.linked_shipment_id)}
                      >
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono font-medium text-sm">{link.shipment_number}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {link.link_type}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px]">
                            {points.length} match point{points.length === 1 ? '' : 's'}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {link.account_name || 'No account'}
                          {link.vendor_name ? ` · ${link.vendor_name}` : ''}
                          {link.expected_pieces ? ` · ${link.expected_pieces} pcs` : ''}
                        </div>
                      </button>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => toggleExpanded(link.linked_shipment_id)}
                          title="Expand match points"
                        >
                          <MaterialIcon
                            name={expandedCandidateIds.has(link.linked_shipment_id) ? 'expand_less' : 'expand_more'}
                            size="sm"
                          />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => openFullDetails(link.linked_shipment_id, link.inbound_kind || link.link_type)}
                          title="Open full details"
                        >
                          <MaterialIcon name="open_in_new" size="sm" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => handleUnlink(link)}
                          title="Unlink"
                        >
                          <MaterialIcon name="link_off" size="sm" />
                        </Button>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="border-t px-3 py-3 space-y-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Match Points</p>
                          {renderMatchPoints(points)}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Items</p>
                          {renderItemsPreview(link.linked_shipment_id)}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Matching Candidates */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="search" size="sm" />
            Matching Candidates
            <HelpTip
              tooltip="Candidates are shown only for the selected account and ranked by match priority: tracking, reference, SKU, vendor, description, then shipper."
              pageKey="incoming.dock_intake_matching"
              fieldKey="matching_candidates"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasAccount ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <MaterialIcon name="info" size="lg" className="mb-2 opacity-40" />
              <p>Select an account in Stage 1 to view matching candidates.</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-6">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
            </div>
          ) : candidateError ? (
            <div className="text-center py-6 text-sm">
              <MaterialIcon name="error" size="lg" className="mb-2 text-destructive opacity-60" />
              <p className="text-destructive">{candidateError}</p>
              <p className="text-muted-foreground mt-1">Check that the matching function is deployed.</p>
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <MaterialIcon name="search_off" size="lg" className="mb-2 opacity-40" />
              <p>
                {candidates.length > 0 && links.length > 0
                  ? 'All matching candidates are already linked.'
                  : 'No candidates for this account.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedCandidateIds.size > 0 ? (
                <div className="flex items-center justify-between gap-2 p-2 rounded-md border bg-muted/20">
                  <div className="text-xs text-muted-foreground">
                    {selectedCandidateIds.size} selected
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleLinkSelected}
                    disabled={linking === 'bulk'}
                    className="h-7"
                  >
                    {linking === 'bulk' ? (
                      <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    ) : (
                      <>
                        <MaterialIcon name="link" size="sm" className="mr-1" />
                        Link Selected
                      </>
                    )}
                  </Button>
                </div>
              ) : null}

              {filteredCandidates.map((candidate) => {
                const points = getMatchPointsForShipment(candidate.shipment_id, candidate.match_points);
                return (
                  <Collapsible
                    key={candidate.shipment_id}
                    open={expandedCandidateIds.has(candidate.shipment_id)}
                    onOpenChange={() => toggleExpanded(candidate.shipment_id)}
                  >
                    <div className="rounded-md border hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between gap-2 p-3">
                        <div className="pt-0.5">
                          <Checkbox
                            checked={selectedCandidateIds.has(candidate.shipment_id)}
                            onCheckedChange={() => toggleSelected(candidate.shipment_id)}
                            aria-label={`Select ${candidate.shipment_number}`}
                          />
                        </div>

                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => openDetailsDialog(candidate.shipment_id)}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-medium text-sm">{candidate.shipment_number}</span>
                            <Badge variant="outline" className="text-[10px]">{candidate.inbound_kind}</Badge>
                            <Badge variant={confidenceBadgeVariant(candidate.confidence_score)}>
                              {candidate.confidence_score}% — {candidate.confidence_label}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] font-mono">{tierLabel(candidate.match_tier)}</Badge>
                            <Badge variant="secondary" className="text-[10px]">
                              {points.length} match point{points.length === 1 ? '' : 's'}
                            </Badge>
                            {candidate.item_match_count > 0 ? (
                              <Badge variant="secondary" className="text-[10px] gap-0.5">
                                <MaterialIcon name="inventory_2" size="sm" />
                                {candidate.item_match_count} item{candidate.item_match_count !== 1 ? 's' : ''}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {candidate.account_name || 'No account'}
                            {candidate.vendor_name ? ` · Vendor: ${candidate.vendor_name}` : ''}
                            {candidate.expected_pieces ? ` · ${candidate.expected_pieces} pcs` : ''}
                            {candidate.eta_start ? ` · ETA: ${formatDate(candidate.eta_start)}` : ''}
                          </div>
                        </button>

                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => toggleExpanded(candidate.shipment_id)}
                            title="Expand match points"
                          >
                            <MaterialIcon
                              name={expandedCandidateIds.has(candidate.shipment_id) ? 'expand_less' : 'expand_more'}
                              size="sm"
                            />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => openFullDetails(candidate.shipment_id, candidate.inbound_kind)}
                            title="Open full details"
                          >
                            <MaterialIcon name="open_in_new" size="sm" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleLink(candidate)}
                            disabled={linking === candidate.shipment_id || linking === 'bulk'}
                          >
                            {linking === candidate.shipment_id ? (
                              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                            ) : (
                              <>
                                <MaterialIcon name="link" size="sm" className="mr-1" />
                                Link
                              </>
                            )}
                          </Button>
                        </div>
                      </div>

                      <CollapsibleContent>
                        <div className="border-t px-3 py-3 space-y-3">
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Match Points</p>
                            {renderMatchPoints(points)}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Items</p>
                            {renderItemsPreview(candidate.shipment_id)}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}

          {showItemRefinement && filteredCandidates.length > 0 ? (
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
              <MaterialIcon name="auto_awesome" size="sm" className="text-amber-500" />
              Item details (description, vendor) from receiving further refine these results.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={!!detailDialogShipmentId} onOpenChange={(open) => !open && setDetailDialogShipmentId(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="visibility" size="sm" />
              {dialogDetails?.shipment_number || 'Shipment details'}
            </DialogTitle>
            <DialogDescription>
              Quick popup details to confirm match points before linking.
            </DialogDescription>
          </DialogHeader>

          {detailDialogShipmentId && detailsByShipmentId[detailDialogShipmentId]?.loading ? (
            <div className="py-6 flex items-center justify-center text-sm text-muted-foreground">
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
              Loading details...
            </div>
          ) : (
            <div className="space-y-4 py-1">
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div><span className="text-muted-foreground">Account:</span> {dialogDetails?.account_name || 'No account'}</div>
                <div><span className="text-muted-foreground">Vendor:</span> {dialogDetails?.vendor_name || '-'}</div>
                <div><span className="text-muted-foreground">Shipper:</span> {dialogDetails?.carrier || '-'}</div>
                <div><span className="text-muted-foreground">Tracking:</span> {dialogDetails?.tracking_number || '-'}</div>
                <div><span className="text-muted-foreground">Reference:</span> {dialogDetails?.po_number || '-'}</div>
                <div><span className="text-muted-foreground">ETA:</span> {formatDate(dialogDetails?.eta_start)}</div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Match Points</p>
                {renderMatchPoints(dialogPoints)}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Items</p>
                {detailDialogShipmentId ? renderItemsPreview(detailDialogShipmentId) : null}
              </div>
            </div>
          )}

          <DialogFooter>
            {detailDialogShipmentId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => openFullDetails(detailDialogShipmentId, dialogDetails?.inbound_kind)}
              >
                <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                Open full details
              </Button>
            ) : null}
            <Button type="button" onClick={() => setDetailDialogShipmentId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
