import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';

export interface ClaimItemSummary {
  id: string;
  item_code?: string;
  description?: string;
  coverage_type: string | null;
  declared_value: number | null;
  weight_lbs: number | null;
  approved_amount: number | null;
  repairable: boolean | null;
  repair_cost: number | null;
  use_repair_cost: boolean;
}

export interface SettlementTermSheetProps {
  claimNumber: string;
  claimType: string;
  description: string;
  accountName: string;
  items: ClaimItemSummary[];
  totalApprovedAmount: number;
  deductibleApplied: number;
  netPayoutAmount: number;
  payoutMethod: 'credit' | 'check' | 'ach';
  warehouseName?: string;
  sentDate?: Date;
  onAccept?: () => void;
  onDecline?: (reason: string, counterOffer?: number, notes?: string) => void;
  isAccepting?: boolean;
  isDeclining?: boolean;
  readOnly?: boolean;
  alreadyAccepted?: boolean;
  alreadyDeclined?: boolean;
}

const CLAIM_TYPE_LABELS: Record<string, string> = {
  shipping_damage: 'Shipping Damage',
  manufacture_defect: 'Manufacture Defect',
  handling_damage: 'Handling Damage',
  property_damage: 'Property Damage',
  lost_item: 'Lost Item',
};

const COVERAGE_TYPE_LABELS: Record<string, string> = {
  standard: 'Standard ($0.72/lb)',
  full_replacement_deductible: 'Full Replacement (w/ deductible)',
  full_replacement_no_deductible: 'Full Replacement (no deductible)',
};

const PAYOUT_METHOD_LABELS: Record<string, string> = {
  credit: 'Account Credit',
  check: 'Check',
  ach: 'ACH/Bank Transfer',
};

export function SettlementTermSheet({
  claimNumber,
  claimType,
  description,
  accountName,
  items,
  totalApprovedAmount,
  deductibleApplied,
  netPayoutAmount,
  payoutMethod,
  warehouseName = 'the Warehouse',
  sentDate,
  onAccept,
  onDecline,
  isAccepting = false,
  isDeclining = false,
  readOnly = false,
  alreadyAccepted = false,
  alreadyDeclined = false,
}: SettlementTermSheetProps) {
  const [accepted, setAccepted] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [counterOfferAmount, setCounterOfferAmount] = useState('');
  const [counterOfferNotes, setCounterOfferNotes] = useState('');

  const handleAccept = () => {
    if (accepted && onAccept) {
      onAccept();
    }
  };

  const handleDecline = () => {
    if (declineReason.trim() && onDecline) {
      const counterAmount = counterOfferAmount ? parseFloat(counterOfferAmount) : undefined;
      onDecline(declineReason, counterAmount, counterOfferNotes || undefined);
    }
  };

  const hasRepairItems = items.some(item => item.repairable && item.use_repair_cost);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <Card>
        <CardHeader className="text-center border-b">
          <CardTitle className="text-2xl">Claim Settlement Terms</CardTitle>
          <CardDescription>
            Claim #{claimNumber} • {CLAIM_TYPE_LABELS[claimType] || claimType}
          </CardDescription>
          {sentDate && (
            <p className="text-sm text-muted-foreground">
              Sent on {format(sentDate, 'MMMM d, yyyy')}
            </p>
          )}
        </CardHeader>
        <CardContent className="pt-6">
          {/* Status Badge */}
          {alreadyAccepted && (
            <div className="flex items-center justify-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg mb-4">
              <MaterialIcon name="check_circle" size="md" className="text-green-600" />
              <span className="text-green-700 dark:text-green-400 font-medium">
                Settlement Accepted
              </span>
            </div>
          )}
          {alreadyDeclined && (
            <div className="flex items-center justify-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg mb-4">
              <MaterialIcon name="warning" size="md" className="text-red-600" />
              <span className="text-red-700 dark:text-red-400 font-medium">
                Settlement Declined
              </span>
            </div>
          )}

          {/* Account Info */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Account</h3>
            <p className="text-lg font-semibold">{accountName}</p>
          </div>

          {/* Claim Description */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Claim Description</h3>
            <p className="text-foreground">{description}</p>
          </div>
        </CardContent>
      </Card>

      {/* Items Involved */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MaterialIcon name="inventory_2" size="md" />
            Items Involved ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {items.map((item, index) => (
              <div
                key={item.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-muted/50 rounded-lg gap-2"
              >
                <div className="flex-1">
                  <p className="font-medium">
                    {item.item_code || `Item ${index + 1}`}
                  </p>
                  {item.description && (
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {COVERAGE_TYPE_LABELS[item.coverage_type || ''] || item.coverage_type || 'No coverage'}
                    </Badge>
                    {item.repairable && item.use_repair_cost && (
                      <Badge variant="secondary" className="text-xs">
                        Repair Approved
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {item.coverage_type === 'standard' && item.weight_lbs && (
                    <p className="text-xs text-muted-foreground">
                      {item.weight_lbs} lbs × $0.72/lb
                    </p>
                  )}
                  {item.declared_value && item.coverage_type !== 'standard' && (
                    <p className="text-xs text-muted-foreground">
                      Declared: ${item.declared_value.toFixed(2)}
                    </p>
                  )}
                  {item.repairable && item.use_repair_cost && item.repair_cost && (
                    <p className="text-xs text-muted-foreground">
                      Repair cost: ${item.repair_cost.toFixed(2)}
                    </p>
                  )}
                  <p className="font-semibold text-primary">
                    ${(item.approved_amount || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Payout Determination */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MaterialIcon name="attach_money" size="md" />
            Payout Determination
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal (approved amounts)</span>
              <span>${totalApprovedAmount.toFixed(2)}</span>
            </div>
            {deductibleApplied > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Deductible</span>
                <span className="text-red-600">-${deductibleApplied.toFixed(2)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold text-lg">
              <span>Net Payout</span>
              <span className="text-primary">${netPayoutAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Payment Method</span>
              <Badge variant="outline">{PAYOUT_METHOD_LABELS[payoutMethod]}</Badge>
            </div>
            {hasRepairItems && (
              <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-4">
                <MaterialIcon name="info" size="md" className="text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 dark:text-blue-400">
                  Some items have been approved for repair. Upon acceptance, a repair task will
                  be created and scheduled.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legal Waiver */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader className="bg-amber-50 dark:bg-amber-900/20 rounded-t-lg">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MaterialIcon name="shield" size="md" className="text-amber-600" />
            Release of Liability
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <p>
              By accepting this settlement, I acknowledge and agree to the following terms:
            </p>
            <ol className="space-y-2 text-sm">
              <li>
                <strong>Full Settlement:</strong> The payment of{' '}
                <strong>${netPayoutAmount.toFixed(2)}</strong> represents the complete and final
                settlement of Claim #{claimNumber}.
              </li>
              <li>
                <strong>Release of Claims:</strong> I hereby release and forever discharge{' '}
                {warehouseName}, its employees, agents, and affiliates from any and all claims,
                demands, damages, actions, or causes of action arising from or related to the
                items and/or property described in this claim.
              </li>
              <li>
                <strong>No Further Liability:</strong> I understand and agree that{' '}
                {warehouseName} shall have no further liability, obligation, or responsibility
                regarding the items or property covered by this claim.
              </li>
              <li>
                <strong>Waiver of Future Claims:</strong> I waive any right to pursue additional
                compensation or make future claims related to the items, property, or incidents
                described herein.
              </li>
              <li>
                <strong>Acknowledgment:</strong> I confirm that I have read and understand these
                terms, and I am accepting this settlement voluntarily and without coercion.
              </li>
            </ol>
          </div>

          {!readOnly && !alreadyAccepted && !alreadyDeclined && (
            <>
              <Separator className="my-6" />

              {!showDeclineForm ? (
                <>
                  {/* Acceptance Checkbox */}
                  <div className="flex items-start space-x-3 p-4 bg-muted/50 rounded-lg">
                    <Checkbox
                      id="accept-terms"
                      checked={accepted}
                      onCheckedChange={(checked) => setAccepted(checked === true)}
                      disabled={isAccepting || isDeclining}
                    />
                    <label
                      htmlFor="accept-terms"
                      className="text-sm font-medium leading-tight cursor-pointer"
                    >
                      I have read and agree to the Release of Liability terms above. I understand
                      that by accepting this settlement, I am waiving any future claims related to
                      this matter.
                    </label>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3 mt-6">
                    <Button
                      onClick={handleAccept}
                      disabled={!accepted || isAccepting || isDeclining}
                      className="flex-1"
                      size="lg"
                    >
                      {isAccepting ? (
                        <>
                          <span className="animate-spin mr-2">⏳</span>
                          Processing...
                        </>
                      ) : (
                        <>
                          <MaterialIcon name="check_circle" size="md" className="mr-2" />
                          Accept Settlement
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowDeclineForm(true)}
                      disabled={isAccepting || isDeclining}
                      className="flex-1"
                      size="lg"
                    >
                      <MaterialIcon name="warning" size="md" className="mr-2" />
                      Decline / Counter Offer
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {/* Decline Form */}
                  <div className="space-y-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                      <MaterialIcon name="warning" size="md" />
                      <span className="font-medium">Decline Settlement</span>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="decline-reason">
                        Reason for declining <span className="text-red-500">*</span>
                      </Label>
                      <Textarea
                        id="decline-reason"
                        placeholder="Please explain why you are declining this settlement..."
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="counter-offer">Counter Offer Amount (optional)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          $
                        </span>
                        <input
                          id="counter-offer"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={counterOfferAmount}
                          onChange={(e) => setCounterOfferAmount(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background pl-7 pr-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="counter-notes">Additional Notes (optional)</Label>
                      <Textarea
                        id="counter-notes"
                        placeholder="Any additional information to support your counter offer..."
                        value={counterOfferNotes}
                        onChange={(e) => setCounterOfferNotes(e.target.value)}
                        rows={2}
                      />
                    </div>

                    <div className="flex gap-3 pt-2">
                      <Button
                        variant="destructive"
                        onClick={handleDecline}
                        disabled={!declineReason.trim() || isDeclining || isAccepting}
                        className="flex-1"
                      >
                        {isDeclining ? (
                          <>
                            <span className="animate-spin mr-2">⏳</span>
                            Submitting...
                          </>
                        ) : counterOfferAmount ? (
                          'Submit Counter Offer'
                        ) : (
                          'Decline Settlement'
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowDeclineForm(false);
                          setDeclineReason('');
                          setCounterOfferAmount('');
                          setCounterOfferNotes('');
                        }}
                        disabled={isDeclining || isAccepting}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center text-sm text-muted-foreground pb-8">
        <p>Claim #{claimNumber} • {warehouseName}</p>
        <p>This document is digitally generated and does not require a physical signature.</p>
      </div>
    </div>
  );
}
