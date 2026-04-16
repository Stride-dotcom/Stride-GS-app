import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PhotoScannerButton } from '@/components/common/PhotoScannerButton';
import { PhotoUploadButton } from '@/components/common/PhotoUploadButton';
import { PhotoGrid } from '@/components/common/PhotoGrid';
import { useAuth } from '@/contexts/AuthContext';
import { ScanDocumentButton } from '@/components/scanner/ScanDocumentButton';
import { DocumentList } from '@/components/scanner/DocumentList';
import { useClaims, CLAIM_TYPE_LABELS, CLAIM_STATUS_LABELS, type Claim, type ClaimItem } from '@/hooks/useClaims';
import { useClaimAnalysis } from '@/hooks/useClaimAnalysis';
import { useClaimReport } from '@/hooks/useClaimReport';
import { ClaimAttachments } from '@/components/claims/ClaimAttachments';
import { ClaimNotes } from '@/components/claims/ClaimNotes';
import { ClaimStatusActions } from '@/components/claims/ClaimStatusActions';
import { ClaimItemsList } from '@/components/claims/ClaimItemsList';
import { ClaimEditDialog } from '@/components/claims/ClaimEditDialog';
import {
  ClaimNotice,
  ClaimAssistanceNotice,
  ClaimAutoApprovedNotice,
} from '@/components/claims/ClaimNotice';
import { format } from 'date-fns';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const CLAIM_CATEGORY_LABELS: Record<string, string> = {
  liability: 'Liability Claim',
  shipping_damage: 'Shipping Damage (Assistance)',
};

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { claims, loading, fetchClaimItems, refetch } = useClaims();
  const {
    analyzing,
    analysis,
    fetchAnalysis,
    analyzeClaim,
    getActionLabel,
    getConfidenceColor,
    getActionColor,
  } = useClaimAnalysis();
  const {
    generating,
    downloadPdfReport,
    downloadClaimPackage,
    copyPublicReportUrl,
  } = useClaimReport();

  const [claim, setClaim] = useState<Claim | null>(null);
  const [claimItems, setClaimItems] = useState<ClaimItem[]>([]);
  const [claimPhotos, setClaimPhotos] = useState<string[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    if (claims.length > 0 && id) {
      const found = claims.find(c => c.id === id);
      setClaim(found || null);
    }
  }, [claims, id]);

  useEffect(() => {
    if (id) {
      fetchClaimItems(id).then(setClaimItems);
      fetchAnalysis(id);
    }
  }, [id, fetchClaimItems, fetchAnalysis]);

  // Refetch claim items when claim is refetched
  const handleRefetch = async () => {
    await refetch();
    if (id) {
      const items = await fetchClaimItems(id);
      setClaimItems(items);
      fetchAnalysis(id);
    }
  };

  // Run AI analysis on the claim
  const handleAnalyzeClaim = async () => {
    if (!id) return;
    await analyzeClaim(id);
    await handleRefetch();
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-96 lg:col-span-2" />
            <Skeleton className="h-96" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!claim) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold text-foreground">Claim not found</h2>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/claims')}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" /> Back to Claims
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">{claim.claim_number}</h1>
                <StatusIndicator status={claim.status} label={CLAIM_STATUS_LABELS[claim.status as keyof typeof CLAIM_STATUS_LABELS]} size="sm" />
              </div>
              <p className="text-muted-foreground">
                {CLAIM_TYPE_LABELS[claim.claim_type as keyof typeof CLAIM_TYPE_LABELS] || claim.claim_type}
                {claim.claim_category && (
                  <span className="ml-2 text-sm">
                    ({CLAIM_CATEGORY_LABELS[claim.claim_category] || claim.claim_category})
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Export Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={generating}>
                  {generating ? (
                    <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                  ) : (
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                  )}
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadPdfReport(claim.id, claim.claim_number)}>
                  <MaterialIcon name="picture_as_pdf" size="sm" className="mr-2" />
                  Download PDF Report
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadClaimPackage(claim.id, claim.claim_number)}>
                  <MaterialIcon name="folder_zip" size="sm" className="mr-2" />
                  Download Full Package
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyPublicReportUrl(claim.id)}>
                  <MaterialIcon name="link" size="sm" className="mr-2" />
                  Copy Public Link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Analyze Button (only for liability claims) */}
            {claim.claim_category !== 'shipping_damage' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyzeClaim}
                disabled={analyzing}
              >
                {analyzing ? (
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                ) : (
                  <MaterialIcon name="analytics" size="sm" className="mr-2" />
                )}
                {analysis ? 'Re-Analyze' : 'Analyze'}
              </Button>
            )}

            <ClaimStatusActions claim={claim} claimItems={claimItems} onUpdate={handleRefetch} />
          </div>
        </div>

        {/* Notices */}
        {claim.auto_approved && claim.approved_payout_amount != null && (
          <ClaimAutoApprovedNotice amount={claim.approved_payout_amount} />
        )}

        {claim.claim_category === 'shipping_damage' && (
          <ClaimAssistanceNotice fee={150} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Overview */}
            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="description" size="md" />
                  Claim Details
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
                  <MaterialIcon name="edit" size="sm" className="mr-1" />
                  Edit
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                  <p className="text-foreground">{claim.description || 'No description provided'}</p>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Account</h4>
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="business" size="sm" className="text-muted-foreground" />
                      <span>{claim.account?.account_name || 'N/A'}</span>
                    </div>
                  </div>
                  {claim.sidemark && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Sidemark</h4>
                      <span>{claim.sidemark.sidemark_name}</span>
                    </div>
                  )}
                </div>

                {claim.item && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Linked Item</h4>
                    <Link to={`/inventory/${claim.item.id}`} className="flex items-center gap-2 text-primary hover:underline">
                      <MaterialIcon name="inventory_2" size="sm" />
                      {claim.item.item_code} - {claim.item.description}
                    </Link>
                  </div>
                )}

                {claim.shipment && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Linked Shipment</h4>
                    <Link to={`/shipments/${claim.shipment.id}`} className="flex items-center gap-2 text-primary hover:underline">
                      <MaterialIcon name="local_shipping" size="sm" />
                      {claim.shipment.shipment_number}
                    </Link>
                  </div>
                )}

                {claim.non_inventory_ref && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Non-Inventory Reference</h4>
                    <p>{claim.non_inventory_ref}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Claim Items (Multi-Item Support) */}
            <ClaimItemsList
              claimId={claim.id}
              claimStatus={claim.status}
              accountId={claim.account_id || undefined}
              sidemarkId={claim.sidemark_id || undefined}
              onItemsChange={handleRefetch}
            />

            {/* Incident & Contact Info - Only show if there's incident data */}
            {(claim.incident_contact_name || claim.incident_location || claim.incident_contact_phone || claim.incident_contact_email) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="description" size="md" />
                    Incident Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {claim.incident_location && <p><strong>Location:</strong> {claim.incident_location}</p>}
                  {claim.incident_contact_name && <p><strong>Contact:</strong> {claim.incident_contact_name}</p>}
                  {claim.incident_contact_phone && <p><strong>Phone:</strong> {claim.incident_contact_phone}</p>}
                  {claim.incident_contact_email && <p><strong>Email:</strong> {claim.incident_contact_email}</p>}
                </CardContent>
              </Card>
            )}

            {/* Tabs */}
            <Tabs defaultValue="photos">
              <TabsList>
                <TabsTrigger value="photos">Photos</TabsTrigger>
                <TabsTrigger value="attachments">Attachments</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="audit">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="photos" className="mt-4">
                <Card>
                  <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MaterialIcon name="photo_camera" size="sm" />
                      Photos ({claimPhotos.length})
                    </CardTitle>
                    <div className="flex gap-2">
                      <PhotoScannerButton
                        entityType="claim"
                        entityId={claim.id}
                        tenantId={profile?.tenant_id}
                        existingPhotos={claimPhotos}
                        maxPhotos={20}
                        onPhotosSaved={(urls) => setClaimPhotos(urls)}
                        size="sm"
                        label="Take Photos"
                        showCount={false}
                      />
                      <PhotoUploadButton
                        entityType="claim"
                        entityId={claim.id}
                        tenantId={profile?.tenant_id}
                        existingPhotos={claimPhotos}
                        maxPhotos={20}
                        onPhotosSaved={(urls) => setClaimPhotos(urls)}
                        size="sm"
                      />
                    </div>
                  </CardHeader>
                  <CardContent>
                    {claimPhotos.length > 0 ? (
                      <PhotoGrid
                        photos={claimPhotos}
                        onPhotosChange={(urls) => setClaimPhotos(urls)}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No photos yet. Tap "Take Photos" to capture.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="attachments" className="mt-4">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <ScanDocumentButton
                      context={{ type: 'general', label: `Claim: ${claim.claim_number}` }}
                      onSuccess={() => {
                        // Optionally refetch
                      }}
                      label="Scan Document"
                      variant="outline"
                    />
                  </div>
                  <ClaimAttachments claimId={claim.id} />
                  <DocumentList
                    contextType="general"
                    contextId={claim.id}
                  />
                </div>
              </TabsContent>

              <TabsContent value="notes" className="mt-4">
                <ClaimNotes claim={claim} onUpdate={handleRefetch} />
              </TabsContent>

              <TabsContent value="audit" className="mt-4">
                <EntityActivityFeed
                  entityType="claim"
                  entityId={claim.id}
                  title="Activity"
                  description="Timeline of all changes to this claim"
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* System Analysis (only for liability claims) */}
            {claim.claim_category !== 'shipping_damage' && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="analytics" size="md" />
                    System Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {analysis ? (
                    <>
                      {/* Recommendation */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Recommendation</span>
                        <Badge className={getActionColor(analysis.recommended_action)}>
                          {getActionLabel(analysis.recommended_action)}
                        </Badge>
                      </div>

                      {/* Amount */}
                      {analysis.recommendation_amount != null && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Suggested Amount</span>
                          <span className="font-bold text-primary">
                            ${analysis.recommendation_amount.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {/* Confidence */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Confidence</span>
                        <Badge variant="outline" className={getConfidenceColor(analysis.confidence_level)}>
                          {analysis.confidence_level.charAt(0).toUpperCase() + analysis.confidence_level.slice(1)}
                        </Badge>
                      </div>

                      {/* Flags */}
                      {analysis.flags && analysis.flags.length > 0 && (
                        <div>
                          <span className="text-sm text-muted-foreground block mb-2">Flags</span>
                          <div className="flex flex-wrap gap-1">
                            {analysis.flags.map((flag, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {flag.replace(/_/g, ' ')}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Reasoning */}
                      {analysis.reasoning && (
                        <div>
                          <span className="text-sm text-muted-foreground block mb-1">Reasoning</span>
                          <p className="text-sm bg-muted p-2 rounded">
                            {analysis.reasoning}
                          </p>
                        </div>
                      )}

                      <Separator />

                      <p className="text-xs text-muted-foreground">
                        Analysis performed using standardized rules (v{analysis.model_version || '1'})
                      </p>
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <MaterialIcon name="analytics" className="mx-auto text-muted-foreground mb-2" style={{ fontSize: '32px' }} />
                      <p className="text-sm text-muted-foreground mb-3">
                        No analysis available yet
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAnalyzeClaim}
                        disabled={analyzing}
                      >
                        {analyzing ? (
                          <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                        ) : (
                          <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
                        )}
                        Run Analysis
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Valuation */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="attach_money" size="md" />
                  Valuation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {claim.coverage_snapshot && (
                  <div>
                    <h4 className="text-sm text-muted-foreground">Coverage Snapshot</h4>
                    <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-auto max-h-32">
                      {JSON.stringify(claim.coverage_snapshot, null, 2)}
                    </pre>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Claimed:</span>
                  </div>
                  <div className="text-right font-medium">
                    {claim.claim_value_requested != null ? `$${claim.claim_value_requested.toFixed(2)}` : 'N/A'}
                  </div>

                  <div>
                    <span className="text-muted-foreground">Calculated:</span>
                  </div>
                  <div className="text-right font-medium">
                    {claim.claim_value_calculated != null ? `$${claim.claim_value_calculated.toFixed(2)}` : 'N/A'}
                  </div>

                  <div>
                    <span className="text-muted-foreground">Deductible:</span>
                  </div>
                  <div className="text-right font-medium">
                    {claim.deductible_applied != null ? `$${claim.deductible_applied.toFixed(2)}` : 'N/A'}
                  </div>

                  <Separator className="col-span-2 my-2" />

                  <div>
                    <span className="text-muted-foreground font-medium">Approved Payout:</span>
                  </div>
                  <div className="text-right font-bold text-primary">
                    {claim.approved_payout_amount != null ? `$${claim.approved_payout_amount.toFixed(2)}` : 'Pending'}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Meta Info */}
            <Card>
              <CardHeader>
                <CardTitle>Meta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Filed By</span>
                  <span>
                    {claim.filed_by_user 
                      ? `${claim.filed_by_user.first_name || ''} ${claim.filed_by_user.last_name || ''}`.trim() || 'Unknown'
                      : 'System'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Filed At</span>
                  <span>{claim.created_at ? format(new Date(claim.created_at), 'MMM d, yyyy') : 'N/A'}</span>
                </div>
                {claim.resolved_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resolved At</span>
                    <span>{format(new Date(claim.resolved_at), 'MMM d, yyyy')}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Edit Dialog */}
        <ClaimEditDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          claim={claim}
          onSave={handleRefetch}
        />
      </div>
    </DashboardLayout>
  );
}
