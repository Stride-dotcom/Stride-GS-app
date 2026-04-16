import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Claim, ClaimStatus, ClaimItem, useClaims } from '@/hooks/useClaims';
import { useCurrentUserRole } from '@/hooks/useRoles';
import { SendForAcceptanceDialog } from './SendForAcceptanceDialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface ClaimStatusActionsProps {
  claim: Claim;
  claimItems?: ClaimItem[];
  onUpdate?: () => void;
}

type PayoutMethod = 'credit' | 'check' | 'ach' | 'other';

export function ClaimStatusActions({ claim, claimItems = [], onUpdate }: ClaimStatusActionsProps) {
  const { updateClaimStatus, sendDetermination, issueCredit, fetchClaimItems } = useClaims();
  const { isAdmin, isManager } = useCurrentUserRole();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ClaimItem[]>(claimItems);

  // Dialog states
  const [showDenyDialog, setShowDenyDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showPayoutDialog, setShowPayoutDialog] = useState(false);
  const [showDeterminationDialog, setShowDeterminationDialog] = useState(false);
  const [showSendForAcceptanceDialog, setShowSendForAcceptanceDialog] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ action: string; status: ClaimStatus } | null>(null);

  // Form data
  const [denialReason, setDenialReason] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [deductible, setDeductible] = useState('');
  const [calculatedAmount, setCalculatedAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('credit');
  const [payoutReference, setPayoutReference] = useState('');
  const [settlementTerms, setSettlementTerms] = useState('');

  // Load claim items if not provided
  useEffect(() => {
    if (claimItems.length > 0) {
      setItems(claimItems);
    } else if (claim.id) {
      fetchClaimItems(claim.id).then(setItems);
    }
  }, [claim.id, claimItems, fetchClaimItems]);

  const handleStatusChange = async (newStatus: ClaimStatus, additionalData?: Record<string, unknown>) => {
    setLoading(true);
    try {
      await updateClaimStatus(claim.id, newStatus, additionalData);
      onUpdate?.();
    } finally {
      setLoading(false);
    }
  };

  const handleMoveToReview = async () => {
    await handleStatusChange('under_review');
  };

  const handleDeny = async () => {
    if (!denialReason.trim()) return;
    await handleStatusChange('denied', { resolution_notes: denialReason });
    setShowDenyDialog(false);
    setDenialReason('');
  };

  const handleApprove = async () => {
    const amount = parseFloat(approvedAmount);
    const ded = parseFloat(deductible) || 0;
    const calc = parseFloat(calculatedAmount) || amount;
    
    if (isNaN(amount) || amount <= 0) return;
    
    await handleStatusChange('approved', {
      approved_payout_amount: amount,
      deductible_applied: ded,
      claim_value_calculated: calc,
    });
    setShowApproveDialog(false);
    setApprovedAmount('');
    setDeductible('');
    setCalculatedAmount('');
  };

  const handleIssuePayout = async () => {
    if (!claim.account_id) return;
    
    const amount = claim.approved_payout_amount || 0;
    
    if (payoutMethod === 'credit') {
      await issueCredit(
        claim.id,
        claim.account_id,
        amount,
        `Claim ${claim.claim_number} settlement`
      );
    } else {
      await handleStatusChange('paid', {
        payout_method: payoutMethod,
        payout_reference: payoutReference,
      });
    }
    
    setShowPayoutDialog(false);
    setPayoutMethod('credit');
    setPayoutReference('');
    onUpdate?.();
  };

  const handleSendDetermination = async () => {
    if (!settlementTerms.trim()) return;
    await sendDetermination(claim.id, settlementTerms);
    setShowDeterminationDialog(false);
    setSettlementTerms('');
    onUpdate?.();
  };

  const handleClose = async () => {
    await handleStatusChange('closed');
  };

  // Helper to check if all items have been determined
  const allItemsDetermined = items.length > 0 && items.every(item => item.approved_amount != null);

  // Render appropriate buttons based on status
  const renderActions = () => {
    switch (claim.status) {
      case 'initiated':
        return (
          <Button onClick={handleMoveToReview} disabled={loading}>
            {loading ? <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" /> : <MaterialIcon name="arrow_forward" size="sm" className="mr-2" />}
            Move to Under Review
          </Button>
        );

      case 'under_review':
        return (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => setShowDenyDialog(true)}
              disabled={loading || items.length === 0}
              title={items.length === 0 ? 'Add items before making a determination' : undefined}
            >
              <MaterialIcon name="cancel" size="sm" className="mr-2" />
              Deny
            </Button>
            {items.length === 0 ? (
              <Button variant="outline" disabled>
                <MaterialIcon name="warning" size="sm" className="mr-2" />
                Add Items First
              </Button>
            ) : allItemsDetermined ? (
              <Button
                variant="default"
                onClick={() => setShowSendForAcceptanceDialog(true)}
                disabled={loading}
              >
                <MaterialIcon name="send" size="sm" className="mr-2" />
                Send for Acceptance
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <MaterialIcon name="warning" size="sm" className="mr-2" />
                Determine All Items First
              </Button>
            )}
          </div>
        );

      case 'pending_acceptance':
        return (
          <div className="flex flex-wrap items-center gap-2">
            <StatusIndicator status="pending_acceptance" label="Waiting for Client" size="sm" />
            {claim.sent_for_acceptance_at && (
              <span className="text-sm text-muted-foreground">
                Sent {new Date(claim.sent_for_acceptance_at).toLocaleDateString()}
              </span>
            )}
          </div>
        );

      case 'accepted':
        return (
          <div className="flex flex-wrap gap-2">
            <StatusIndicator status="accepted" label="Client Accepted" size="sm" />
            {isManager && (
              <Button onClick={() => setShowPayoutDialog(true)} disabled={loading}>
                <MaterialIcon name="attach_money" size="sm" className="mr-2" />
                Issue Payout
              </Button>
            )}
          </div>
        );

      case 'declined':
        return (
          <div className="flex flex-wrap gap-2">
            <StatusIndicator status="declined" label="Client Declined" size="sm" />
            {claim.counter_offer_amount && (
              <Badge variant="secondary">
                Counter: ${claim.counter_offer_amount.toFixed(2)}
              </Badge>
            )}
            <Button variant="outline" onClick={handleMoveToReview} disabled={loading}>
              Re-review Claim
            </Button>
          </div>
        );

      case 'approved':
        return (
          <div className="flex flex-wrap gap-2">
            {!claim.sent_for_acceptance_at && (
              <Button
                variant="outline"
                onClick={() => setShowSendForAcceptanceDialog(true)}
                disabled={loading}
              >
                <MaterialIcon name="send" size="sm" className="mr-2" />
                Send for Acceptance
              </Button>
            )}
            {isManager && claim.settlement_accepted_at && (
              <Button onClick={() => setShowPayoutDialog(true)} disabled={loading}>
                <MaterialIcon name="attach_money" size="sm" className="mr-2" />
                Issue Payout
              </Button>
            )}
          </div>
        );

      case 'credited':
      case 'paid':
        return (
          <div className="flex flex-wrap gap-2">
            <StatusIndicator status="paid" label="Payout Complete" size="sm" />
            <Button variant="outline" onClick={() => setConfirmDialog({ action: 'Close', status: 'closed' })} disabled={loading}>
              Close Claim
            </Button>
          </div>
        );

      case 'denied':
        return (
          <Button variant="outline" onClick={() => setConfirmDialog({ action: 'Close', status: 'closed' })} disabled={loading}>
            Close Claim
          </Button>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {renderActions()}
      </div>

      {/* Deny Dialog */}
      <Dialog open={showDenyDialog} onOpenChange={setShowDenyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Claim</DialogTitle>
            <DialogDescription>
              Provide a reason for denying this claim. This will be visible to the client.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Denial Reason (Public Note)</Label>
              <Textarea
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                placeholder="Explain why the claim is being denied..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDenyDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeny} disabled={!denialReason.trim() || loading}>
              {loading && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
              Deny Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Claim</DialogTitle>
            <DialogDescription>
              Enter the approved payout amount and any applicable deductible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Calculated Value ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={calculatedAmount}
                onChange={(e) => setCalculatedAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Deductible ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={deductible}
                onChange={(e) => setDeductible(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Approved Payout Amount ($) *</Label>
              <Input
                type="number"
                step="0.01"
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>Cancel</Button>
            <Button onClick={handleApprove} disabled={!approvedAmount || loading}>
              {loading && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
              Approve Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payout Dialog */}
      <Dialog open={showPayoutDialog} onOpenChange={setShowPayoutDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Payout</DialogTitle>
            <DialogDescription>
              Choose how to issue the approved amount of ${claim.approved_payout_amount?.toFixed(2) || '0.00'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Payout Method</Label>
              <Select value={payoutMethod} onValueChange={(v) => setPayoutMethod(v as PayoutMethod)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Billing Credit</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="ach">ACH Transfer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payoutMethod !== 'credit' && (
              <div className="space-y-2">
                <Label>Reference Number</Label>
                <Input
                  value={payoutReference}
                  onChange={(e) => setPayoutReference(e.target.value)}
                  placeholder="Check #, Transaction ID, etc."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayoutDialog(false)}>Cancel</Button>
            <Button onClick={handleIssuePayout} disabled={loading}>
              {loading && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
              Issue Payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Determination Dialog */}
      <Dialog open={showDeterminationDialog} onOpenChange={setShowDeterminationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Determination to Client</DialogTitle>
            <DialogDescription>
              This will notify the client of the claim decision and approved amount.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Settlement Terms</Label>
              <Textarea
                value={settlementTerms}
                onChange={(e) => setSettlementTerms(e.target.value)}
                placeholder="Enter the terms of the settlement..."
                rows={4}
              />
            </div>
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm">
                <strong>Approved Amount:</strong> ${claim.approved_payout_amount?.toFixed(2) || '0.00'}
              </p>
              {claim.deductible_applied && (
                <p className="text-sm">
                  <strong>Deductible Applied:</strong> ${claim.deductible_applied.toFixed(2)}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeterminationDialog(false)}>Cancel</Button>
            <Button onClick={handleSendDetermination} disabled={!settlementTerms.trim() || loading}>
              {loading && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
              Send to Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <AlertDialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {confirmDialog?.action}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to {confirmDialog?.action.toLowerCase()} this claim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDialog) {
                  handleStatusChange(confirmDialog.status);
                }
                setConfirmDialog(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send for Acceptance Dialog */}
      <SendForAcceptanceDialog
        open={showSendForAcceptanceDialog}
        onOpenChange={setShowSendForAcceptanceDialog}
        claim={claim}
        claimItems={items}
        onSuccess={() => {
          setShowSendForAcceptanceDialog(false);
          onUpdate?.();
        }}
      />
    </div>
  );
}
