/**
 * ClaimEditDialog Component
 * Dialog for editing claim details including customer info, incident info, and valuation
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SaveButton } from '@/components/ui/SaveButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useClaims, Claim, CLAIM_TYPE_LABELS, ClaimType } from '@/hooks/useClaims';
import { AccountSelect } from '@/components/ui/account-select';
import { SidemarkSelect } from '@/components/ui/sidemark-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

interface ClaimEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: Claim;
  onSave: () => void;
}

export function ClaimEditDialog({
  open,
  onOpenChange,
  claim,
  onSave,
}: ClaimEditDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { updateClaim } = useClaims();
  const [activeTab, setActiveTab] = useState('details');

  // Form state
  const [formData, setFormData] = useState({
    claim_type: claim.claim_type || '',
    account_id: claim.account_id || '',
    sidemark_id: claim.sidemark_id || '',
    description: claim.description || '',
    non_inventory_ref: claim.non_inventory_ref || '',
    // Incident info
    incident_location: claim.incident_location || '',
    incident_contact_name: claim.incident_contact_name || '',
    incident_contact_phone: claim.incident_contact_phone || '',
    incident_contact_email: claim.incident_contact_email || '',
    // Valuation
    claim_value_requested: claim.claim_value_requested?.toString() || '',
    claim_value_calculated: claim.claim_value_calculated?.toString() || '',
    deductible_applied: claim.deductible_applied?.toString() || '',
    approved_payout_amount: claim.approved_payout_amount?.toString() || '',
  });

  // Reset form when claim changes
  useEffect(() => {
    if (open && claim) {
      setFormData({
        claim_type: claim.claim_type || '',
        account_id: claim.account_id || '',
        sidemark_id: claim.sidemark_id || '',
        description: claim.description || '',
        non_inventory_ref: claim.non_inventory_ref || '',
        incident_location: claim.incident_location || '',
        incident_contact_name: claim.incident_contact_name || '',
        incident_contact_phone: claim.incident_contact_phone || '',
        incident_contact_email: claim.incident_contact_email || '',
        claim_value_requested: claim.claim_value_requested?.toString() || '',
        claim_value_calculated: claim.claim_value_calculated?.toString() || '',
        deductible_applied: claim.deductible_applied?.toString() || '',
        approved_payout_amount: claim.approved_payout_amount?.toString() || '',
      });
    }
  }, [open, claim]);

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!profile?.tenant_id) return;

    try {
      // Build update object, only including changed fields
      const updateData: Record<string, unknown> = {};

      if (formData.claim_type && formData.claim_type !== claim.claim_type) {
        updateData.claim_type = formData.claim_type;
      }
      if (formData.account_id !== claim.account_id) {
        updateData.account_id = formData.account_id || null;
      }
      if (formData.sidemark_id !== claim.sidemark_id) {
        updateData.sidemark_id = formData.sidemark_id || null;
      }
      if (formData.description !== claim.description) {
        updateData.description = formData.description;
      }
      if (formData.non_inventory_ref !== claim.non_inventory_ref) {
        updateData.non_inventory_ref = formData.non_inventory_ref || null;
      }
      if (formData.incident_location !== claim.incident_location) {
        updateData.incident_location = formData.incident_location || null;
      }
      if (formData.incident_contact_name !== claim.incident_contact_name) {
        updateData.incident_contact_name = formData.incident_contact_name || null;
      }
      if (formData.incident_contact_phone !== claim.incident_contact_phone) {
        updateData.incident_contact_phone = formData.incident_contact_phone || null;
      }
      if (formData.incident_contact_email !== claim.incident_contact_email) {
        updateData.incident_contact_email = formData.incident_contact_email || null;
      }

      // Valuation fields
      const requestedVal = formData.claim_value_requested ? parseFloat(formData.claim_value_requested) : null;
      if (requestedVal !== claim.claim_value_requested) {
        updateData.claim_value_requested = requestedVal;
      }
      const calculatedVal = formData.claim_value_calculated ? parseFloat(formData.claim_value_calculated) : null;
      if (calculatedVal !== claim.claim_value_calculated) {
        updateData.claim_value_calculated = calculatedVal;
      }
      const deductibleVal = formData.deductible_applied ? parseFloat(formData.deductible_applied) : null;
      if (deductibleVal !== claim.deductible_applied) {
        updateData.deductible_applied = deductibleVal;
      }
      const approvedVal = formData.approved_payout_amount ? parseFloat(formData.approved_payout_amount) : null;
      if (approvedVal !== claim.approved_payout_amount) {
        updateData.approved_payout_amount = approvedVal;
      }

      if (Object.keys(updateData).length === 0) {
        toast({ title: 'No changes to save' });
        onOpenChange(false);
        return;
      }

      // Add audit entry with field changes
      const changedFields = Object.keys(updateData);
      await supabase.from('claim_audit').insert([{
        tenant_id: profile.tenant_id,
        claim_id: claim.id,
        actor_id: profile.id,
        action: 'fields_updated',
        details: JSON.parse(JSON.stringify({
          changed_fields: changedFields,
          changes: updateData,
        })),
      }]);

      const result = await updateClaim(claim.id, updateData);

      if (result) {
        onSave();
        onOpenChange(false);
      }
    } catch (error: any) {
      console.error('Error updating claim:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to update claim',
      });
      throw error;
    }
  };

  const claimTypes = Object.entries(CLAIM_TYPE_LABELS) as [ClaimType, string][];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="edit" size="md" />
            Edit Claim
          </DialogTitle>
          <DialogDescription>
            Update claim details, customer information, and valuation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => e.preventDefault()} className="flex-1 overflow-hidden flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
            <TabsList className="flex-shrink-0">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="customer">Customer</TabsTrigger>
              <TabsTrigger value="valuation">Valuation</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto min-h-0 mt-4 pr-2">
              <TabsContent value="details" className="space-y-4 mt-0">
                {/* Claim Type */}
                <div className="space-y-2">
                  <Label>Claim Type</Label>
                  <Select
                    value={formData.claim_type}
                    onValueChange={(v) => handleChange('claim_type', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {claimTypes.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Account */}
                <div className="space-y-2">
                  <Label>Account</Label>
                  <AccountSelect
                    value={formData.account_id}
                    onChange={(v) => handleChange('account_id', v || '')}
                    placeholder="Select account..."
                  />
                </div>

                {/* Sidemark */}
                <div className="space-y-2">
                  <Label>Sidemark</Label>
                  <SidemarkSelect
                    accountId={formData.account_id}
                    value={formData.sidemark_id}
                    onChange={(v) => handleChange('sidemark_id', v)}
                    placeholder="Select sidemark..."
                  />
                </div>

                {/* Non-Inventory Reference */}
                <div className="space-y-2">
                  <Label>Non-Inventory Reference</Label>
                  <Input
                    value={formData.non_inventory_ref}
                    onChange={(e) => handleChange('non_inventory_ref', e.target.value)}
                    placeholder="e.g., Wall repair at 123 Main St"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use this for claims not related to inventory items (e.g., property damage)
                  </p>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => handleChange('description', e.target.value)}
                    placeholder="Describe the claim..."
                    rows={3}
                  />
                </div>
              </TabsContent>

              <TabsContent value="customer" className="space-y-4 mt-0">
                {/* Incident Location */}
                <div className="space-y-2">
                  <Label>Incident Location</Label>
                  <Input
                    value={formData.incident_location}
                    onChange={(e) => handleChange('incident_location', e.target.value)}
                    placeholder="Where did the incident occur?"
                  />
                </div>

                {/* Contact Name */}
                <div className="space-y-2">
                  <Label>Contact Name</Label>
                  <Input
                    value={formData.incident_contact_name}
                    onChange={(e) => handleChange('incident_contact_name', e.target.value)}
                    placeholder="Customer or claimant name"
                  />
                </div>

                {/* Contact Phone */}
                <div className="space-y-2">
                  <Label>Contact Phone</Label>
                  <Input
                    type="tel"
                    value={formData.incident_contact_phone}
                    onChange={(e) => handleChange('incident_contact_phone', e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>

                {/* Contact Email */}
                <div className="space-y-2">
                  <Label>Contact Email</Label>
                  <Input
                    type="email"
                    value={formData.incident_contact_email}
                    onChange={(e) => handleChange('incident_contact_email', e.target.value)}
                    placeholder="customer@example.com"
                  />
                </div>
              </TabsContent>

              <TabsContent value="valuation" className="space-y-4 mt-0">
                {/* Value Requested */}
                <div className="space-y-2">
                  <Label>Value Requested</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.claim_value_requested}
                      onChange={(e) => handleChange('claim_value_requested', e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                {/* Value Calculated */}
                <div className="space-y-2">
                  <Label>Value Calculated</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.claim_value_calculated}
                      onChange={(e) => handleChange('claim_value_calculated', e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                {/* Deductible */}
                <div className="space-y-2">
                  <Label>Deductible Applied</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.deductible_applied}
                      onChange={(e) => handleChange('deductible_applied', e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>

                {/* Approved Payout */}
                <div className="space-y-2">
                  <Label>Approved Payout Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.approved_payout_amount}
                      onChange={(e) => handleChange('approved_payout_amount', e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="notes" className="space-y-4 mt-0">
                <UnifiedNotesSection
                  entityType="claim"
                  entityId={claim.id}
                  entityNumber={claim.claim_number}
                  embedded
                  allowedNoteTypes={['internal', 'public']}
                />
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="flex-shrink-0 pt-4 border-t mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SaveButton
              onClick={handleSave}
              label="Save Changes"
              savingLabel="Saving..."
              savedLabel="Saved"
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
