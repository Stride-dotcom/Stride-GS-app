import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import {
  useClientPortalContext,
  useClientClaims,
  useClientClaimDetail,
} from '@/hooks/useClientPortal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';
import {
  ClaimNotice,
  ClaimAssistanceNotice,
  ClaimAutoApprovedNotice,
  ClaimDocumentationNotice,
} from '@/components/claims/ClaimNotice';

const statusLabels: Record<string, string> = {
  initiated: 'Submitted',
  under_review: 'Under Review',
  pending_acceptance: 'Awaiting Your Response',
  accepted: 'Accepted',
  declined: 'Declined',
  denied: 'Denied',
  approved: 'Approved',
  credited: 'Credit Issued',
  paid: 'Paid',
  closed: 'Closed',
};

const claimTypeLabels: Record<string, string> = {
  shipping_damage: 'Shipping Damage',
  manufacture_defect: 'Manufacture Defect',
  handling_damage: 'Handling Damage',
  property_damage: 'Property Damage',
  lost_item: 'Lost Item',
};

const claimCategoryLabels: Record<string, string> = {
  liability: 'Liability Claim (Warehouse)',
  shipping_damage: 'Shipping Damage (Carrier)',
};

// Map claim types to categories
const claimTypeToCategory: Record<string, 'liability' | 'shipping_damage'> = {
  shipping_damage: 'shipping_damage',
  manufacture_defect: 'liability',
  handling_damage: 'liability',
  property_damage: 'liability',
  lost_item: 'liability',
};

export default function ClientClaims() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedClaimId = searchParams.get('id');

  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();
  const { data: claims = [], isLoading: claimsLoading } = useClientClaims();
  const { data: claimDetail, isLoading: detailLoading } = useClientClaimDetail(selectedClaimId || undefined);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // New claim form
  const [newClaim, setNewClaim] = useState({
    claim_type: '' as string,
    description: '',
    incident_date: '',
  });

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  const handleSelectClaim = (claimId: string) => {
    setSearchParams({ id: claimId });
  };

  const handleBackToList = () => {
    setSearchParams({});
  };

  const handleCreateClaim = async () => {
    if (!portalUser || !newClaim.claim_type || !newClaim.description) return;

    try {
      setSubmitting(true);

      // Generate claim number
      const claimNumber = `CLM-${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9000 + 1000)}`;

      // Determine claim category based on type
      const claimCategory = claimTypeToCategory[newClaim.claim_type] || 'liability';

      const { error } = await supabase.from('claims').insert({
        tenant_id: portalUser.tenant_id,
        account_id: portalUser.account_id,
        claim_number: claimNumber,
        claim_type: newClaim.claim_type,
        claim_category: claimCategory,
        description: newClaim.description,
        incident_date: newClaim.incident_date || null,
        status: 'initiated',
        client_initiated: true,
        filed_by: null, // Client initiated
      });

      if (error) throw error;

      toast({
        title: 'Claim Submitted',
        description: `Claim ${claimNumber} has been submitted for review.`,
      });

      setShowCreateDialog(false);
      setNewClaim({ claim_type: '', description: '', incident_date: '' });
      queryClient.invalidateQueries({ queryKey: ['client-claims'] });
    } catch (error) {
      console.error('Error creating claim:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to submit claim. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !claimDetail || !portalUser) return;

    try {
      setUploading(true);

      for (const file of Array.from(files)) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const storagePath = `${portalUser.tenant_id}/${claimDetail.id}/${fileName}`;

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('claims')
          .upload(storagePath, file);

        if (uploadError) throw uploadError;

        // Create attachment record
        await supabase.from('claim_attachments').insert({
          tenant_id: portalUser.tenant_id,
          claim_id: claimDetail.id,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          uploaded_by: portalUser.id,
          is_public: true,
          category: file.type.startsWith('image/') ? 'damage_photos' : 'other',
        });

        // Add audit entry
        await supabase.from('claim_audit').insert({
          tenant_id: portalUser.tenant_id,
          claim_id: claimDetail.id,
          action: 'client_uploaded_attachment',
          details: { file_name: file.name },
        });
      }

      toast({
        title: 'File Uploaded',
        description: `${files.length} file(s) uploaded successfully.`,
      });

      queryClient.invalidateQueries({ queryKey: ['client-claim-detail'] });
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to upload file.',
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (contextLoading) {
    return (
      <ClientPortalLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </ClientPortalLayout>
    );
  }

  // Claim Detail View
  if (selectedClaimId && claimDetail) {
    const canAccept = claimDetail.status === 'pending_acceptance' && claimDetail.acceptance_token;

    return (
      <ClientPortalLayout accountName={account?.name} warehouseName={tenant?.name} userName={userName}>
        <div className="space-y-6">
          {/* Back Button and Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleBackToList}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{claimDetail.claim_number}</h1>
                <StatusIndicator status={claimDetail.status} label={statusLabels[claimDetail.status]} size="sm" />
              </div>
              <p className="text-muted-foreground">
                {claimTypeLabels[claimDetail.claim_type] || claimDetail.claim_type}
                {(claimDetail as any).claim_category && (
                  <span className="ml-2 text-sm">
                    ({claimCategoryLabels[(claimDetail as any).claim_category] || (claimDetail as any).claim_category})
                  </span>
                )}
              </p>
            </div>

            {/* Action to Accept/View Settlement */}
            {canAccept && (
              <Link to={`/claim/accept/${claimDetail.acceptance_token}`} target="_blank">
                <Button>
                  <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                  Review & Accept Settlement
                </Button>
              </Link>
            )}
          </div>

          {/* Claim Processing Notice */}
          <ClaimNotice context="portal_detail" compact />

          {/* Shipping Damage Assistance Notice */}
          {(claimDetail as any).claim_category === 'shipping_damage' && (
            <ClaimAssistanceNotice fee={150} />
          )}

          {/* Auto-Approved Notice */}
          {(claimDetail as any).auto_approved && (claimDetail as any).approved_payout_amount != null && (
            <ClaimAutoApprovedNotice amount={(claimDetail as any).approved_payout_amount} />
          )}

          <div className="grid gap-6 md:grid-cols-3">
            {/* Main Content */}
            <div className="md:col-span-2 space-y-6">
              {/* Claim Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="description" size="md" />
                    Claim Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-1">Description</h4>
                    <p>{claimDetail.description || 'No description provided'}</p>
                  </div>

                  {claimDetail.incident_date && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Incident Date</h4>
                      <p>{format(new Date(claimDetail.incident_date), 'MMMM d, yyyy')}</p>
                    </div>
                  )}

                  {claimDetail.sidemark && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Sidemark</h4>
                      <p>{claimDetail.sidemark.sidemark_name}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Items (if any) */}
              {claimDetail.items && claimDetail.items.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MaterialIcon name="inventory_2" size="md" />
                      Items ({claimDetail.items.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {claimDetail.items.map((item: any) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            {item.item?.primary_photo_url ? (
                              <img
                                src={item.item.primary_photo_url}
                                alt={item.item.item_code}
                                className="h-12 w-12 object-cover rounded"
                              />
                            ) : (
                              <div className="h-12 w-12 bg-muted rounded flex items-center justify-center">
                                <MaterialIcon name="inventory_2" size="lg" className="text-muted-foreground" />
                              </div>
                            )}
                            <div>
                              <p className="font-medium">{item.item?.item_code || 'Item'}</p>
                              <p className="text-sm text-muted-foreground">
                                {item.item?.description || 'No description'}
                              </p>
                            </div>
                          </div>
                          {item.approved_amount != null && (
                            <Badge variant="outline">
                              ${item.approved_amount.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Settlement Info (only if sent for acceptance) */}
              {claimDetail.sent_for_acceptance_at && claimDetail.total_approved_amount != null && (
                <Card className="border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MaterialIcon name="shield" size="md" />
                      Settlement Determination
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Approved Amount</span>
                      <span className="text-2xl font-bold text-primary">
                        ${claimDetail.total_approved_amount.toFixed(2)}
                      </span>
                    </div>
                    {claimDetail.payout_method && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Payout Method</span>
                        <Badge variant="outline">
                          {claimDetail.payout_method === 'credit'
                            ? 'Account Credit'
                            : claimDetail.payout_method === 'check'
                            ? 'Check'
                            : 'ACH Transfer'}
                        </Badge>
                      </div>
                    )}

                    {canAccept && (
                      <div className="pt-4">
                        <Link to={`/claim/accept/${claimDetail.acceptance_token}`} target="_blank">
                          <Button className="w-full" size="lg">
                            <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                            Review & Accept Settlement Terms
                          </Button>
                        </Link>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Attachments & Notes */}
              <Tabs defaultValue="attachments">
                <TabsList>
                  <TabsTrigger value="attachments">
                    Attachments ({claimDetail.attachments?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>

                <TabsContent value="attachments" className="mt-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-base">Attachments</CardTitle>
                      <div className="relative">
                        <input
                          type="file"
                          multiple
                          accept="image/*,.pdf,.doc,.docx"
                          onChange={handleUploadFile}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          disabled={uploading}
                        />
                        <Button variant="outline" size="sm" disabled={uploading}>
                          {uploading ? (
                            <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                          ) : (
                            <MaterialIcon name="upload" size="sm" className="mr-2" />
                          )}
                          Upload
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {claimDetail.attachments?.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8">
                          No attachments yet. Upload photos or documents.
                        </p>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {claimDetail.attachments?.map((att: any) => (
                            <div
                              key={att.id}
                              className="flex items-center gap-3 p-3 border rounded-lg"
                            >
                              {att.mime_type?.startsWith('image/') ? (
                                <MaterialIcon name="image" size="xl" className="text-blue-500" />
                              ) : (
                                <MaterialIcon name="description" size="xl" className="text-gray-500" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{att.file_name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(new Date(att.created_at), { addSuffix: true })}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="notes" className="mt-4">
                  <UnifiedNotesSection
                    entityType="claim"
                    entityId={claimDetail.id}
                    entityNumber={claimDetail.claim_number}
                    embedded
                    isClientUser
                    allowClientWrite
                    allowedNoteTypes={['public']}
                    forcedNoteType="public"
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Filed</span>
                    <span>{format(new Date(claimDetail.created_at), 'MMM d, yyyy')}</span>
                  </div>
                  {claimDetail.sent_for_acceptance_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Sent for Acceptance</span>
                      <span>{format(new Date(claimDetail.sent_for_acceptance_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                  {claimDetail.settlement_accepted_at && (
                    <div className="flex justify-between text-green-600">
                      <span>Accepted</span>
                      <span>{format(new Date(claimDetail.settlement_accepted_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                  {claimDetail.settlement_declined_at && (
                    <div className="flex justify-between text-red-600">
                      <span>Declined</span>
                      <span>{format(new Date(claimDetail.settlement_declined_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {claimDetail.client_initiated && (
                <Card className="border-blue-200 bg-blue-50/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 text-blue-700">
                      <MaterialIcon name="check_circle" size="sm" />
                      <span className="text-sm font-medium">Client Initiated</span>
                    </div>
                    <p className="text-xs text-blue-600 mt-1">
                      This claim was submitted by you.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>

      </ClientPortalLayout>
    );
  }

  // Claims List View
  return (
    <ClientPortalLayout accountName={account?.name} warehouseName={tenant?.name} userName={userName}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Claims</h1>
            <p className="text-muted-foreground">View and manage your damage claims</p>
          </div>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <MaterialIcon name="add" size="sm" className="mr-2" />
                File New Claim
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>File New Claim</DialogTitle>
                <DialogDescription>
                  Submit a new damage or loss claim for review.
                </DialogDescription>
              </DialogHeader>

              {/* Claims Processing Notice */}
              <ClaimNotice context="portal_submission" compact />

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Claim Type *</Label>
                  <Select
                    value={newClaim.claim_type}
                    onValueChange={(v) => setNewClaim((prev) => ({ ...prev, claim_type: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select claim type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shipping_damage">Shipping Damage</SelectItem>
                      <SelectItem value="manufacture_defect">Manufacture Defect</SelectItem>
                      <SelectItem value="handling_damage">Handling Damage</SelectItem>
                      <SelectItem value="property_damage">Property Damage</SelectItem>
                      <SelectItem value="lost_item">Lost Item</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Show shipping damage assistance info */}
                  {newClaim.claim_type === 'shipping_damage' && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Shipping damage claims are filed with the carrier. We will assist with the
                      claim process on your behalf. A claim assistance fee may apply.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Incident Date</Label>
                  <Input
                    type="date"
                    value={newClaim.incident_date}
                    onChange={(e) =>
                      setNewClaim((prev) => ({ ...prev, incident_date: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Textarea
                    value={newClaim.description}
                    onChange={(e) =>
                      setNewClaim((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="Describe the damage or loss..."
                    rows={4}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateClaim}
                  disabled={!newClaim.claim_type || !newClaim.description || submitting}
                >
                  {submitting && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
                  Submit Claim
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Claims List */}
        {claimsLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : claims.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <MaterialIcon name="shield" className="mx-auto text-muted-foreground mb-4" style={{ fontSize: '48px' }} />
              <h3 className="text-lg font-medium mb-2">No Claims</h3>
              <p className="text-muted-foreground mb-4">
                You haven't filed any claims yet.
              </p>
              <Button onClick={() => setShowCreateDialog(true)}>
                <MaterialIcon name="add" size="sm" className="mr-2" />
                File New Claim
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Pending Action Alert */}
            {claims.filter((c: any) => c.status === 'pending_acceptance').length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-amber-800">
                    <MaterialIcon name="error" size="md" />
                    Action Required
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-amber-700 text-sm">
                    You have {claims.filter((c: any) => c.status === 'pending_acceptance').length} claim(s)
                    awaiting your response. Please review and accept or decline the settlement.
                  </p>
                </CardContent>
              </Card>
            )}

            {claims.map((claim: any) => (
              <Card
                key={claim.id}
                className={`cursor-pointer hover:shadow-md transition-shadow ${
                  claim.status === 'pending_acceptance' ? 'border-amber-300' : ''
                }`}
                onClick={() => handleSelectClaim(claim.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`h-10 w-10 rounded-full flex items-center justify-center ${
                          claim.status === 'pending_acceptance'
                            ? 'bg-amber-100'
                            : claim.status === 'accepted' || claim.status === 'credited' || claim.status === 'paid'
                            ? 'bg-green-100'
                            : claim.status === 'denied' || claim.status === 'declined'
                            ? 'bg-red-100'
                            : 'bg-blue-100'
                        }`}
                      >
                        {claim.status === 'pending_acceptance' ? (
                          <MaterialIcon name="schedule" size="md" className="text-amber-600" />
                        ) : claim.status === 'accepted' || claim.status === 'credited' || claim.status === 'paid' ? (
                          <MaterialIcon name="check_circle" size="md" className="text-green-600" />
                        ) : claim.status === 'denied' || claim.status === 'declined' ? (
                          <MaterialIcon name="cancel" size="md" className="text-red-600" />
                        ) : (
                          <MaterialIcon name="description" size="md" className="text-blue-600" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{claim.claim_number}</p>
                          <StatusIndicator status={claim.status} label={statusLabels[claim.status]} size="sm" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {claimTypeLabels[claim.claim_type] || claim.claim_type}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {claim.total_approved_amount != null && (
                        <p className="font-semibold text-primary">
                          ${claim.total_approved_amount.toFixed(2)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(claim.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </ClientPortalLayout>
  );
}
