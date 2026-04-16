import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { useClientQuoteReview } from '@/hooks/useRepairQuotes';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';

export default function ClientQuoteReview() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const {
    loading,
    error,
    tokenData,
    quote,
    quoteItems,
    submitting,
    acceptQuote,
    declineQuote,
  } = useClientQuoteReview(token);

  const [showAcceptDialog, setShowAcceptDialog] = useState(false);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);

  const handleAccept = async () => {
    const success = await acceptQuote();
    if (success) {
      setAccepted(true);
      setShowAcceptDialog(false);
    }
  };

  const handleDecline = async () => {
    const success = await declineQuote(declineReason);
    if (success) {
      setDeclined(true);
      setShowDeclineDialog(false);
    }
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-';
    return `$${amount.toFixed(2)}`;
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4">
          <MaterialIcon name="progress_activity" className="animate-spin mx-auto text-primary" style={{ fontSize: '48px' }} />
          <p className="text-muted-foreground">Loading your quote...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <MaterialIcon name="warning" size="lg" className="text-destructive" />
            </div>
            <CardTitle>Quote Unavailable</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground text-center">
              If you need assistance, please contact the warehouse directly.
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Accepted success state
  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <MaterialIcon name="check_circle" size="lg" className="text-green-600" />
            </div>
            <CardTitle>Quote Accepted</CardTitle>
            <CardDescription>
              Thank you for your approval!
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                {formatCurrency(quote?.customer_total)}
              </p>
              <p className="text-sm text-green-600 dark:text-green-500">
                Approved Repair Amount
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              The warehouse has been notified and will begin the repair process.
              You will receive updates as work progresses.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Declined state
  if (declined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <MaterialIcon name="cancel" size="lg" className="text-amber-600" />
            </div>
            <CardTitle>Quote Declined</CardTitle>
            <CardDescription>
              We've received your decision.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              The warehouse has been notified. If you have any questions or would
              like to discuss alternative options, please contact them directly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <MaterialIcon name="description" size="md" className="text-primary" />
              </div>
              <div className="flex-1">
                <CardTitle>Repair Quote</CardTitle>
                <CardDescription>
                  Please review and respond to this repair estimate
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              {quote?.account && (
                <div className="flex items-center gap-2">
                  <MaterialIcon name="business" size="sm" className="text-muted-foreground" />
                  <span className="font-medium">{quote.account.name}</span>
                </div>
              )}
              {quote?.sidemark && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Project:</span>
                  <Badge variant="outline">{quote.sidemark.name}</Badge>
                </div>
              )}
              {tokenData?.expires_at && (
                <div className="flex items-center gap-2 text-amber-600">
                  <MaterialIcon name="schedule" size="sm" />
                  <span>
                    Valid until: {format(new Date(tokenData.expires_at), 'MMM d, yyyy')}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quote Summary */}
        <Card className="border-primary/20">
          <CardHeader className="bg-primary/5">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="attach_money" size="md" />
                Repair Estimate
              </CardTitle>
              <div className="text-right">
                <p className="text-3xl font-bold text-primary">
                  {formatCurrency(quote?.customer_total)}
                </p>
                <p className="text-sm text-muted-foreground">Total Amount</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Labor</span>
                <span>
                  {quote?.tech_labor_hours} hours @ {formatCurrency(quote?.tech_labor_rate)}/hr
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Materials</span>
                <span>{formatCurrency(quote?.tech_materials_cost)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-medium">
                <span>Total</span>
                <span className="text-primary">{formatCurrency(quote?.customer_total)}</span>
              </div>
            </div>

            {quote?.tech_notes && (
              <div className="mt-4 bg-muted/50 rounded-lg p-3">
                <p className="text-sm font-medium mb-1">Notes from Repair Team</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {quote.tech_notes}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Items to Repair */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="inventory_2" size="md" />
              Items Included ({quoteItems.length})
            </CardTitle>
            <CardDescription>
              The following items are included in this repair quote
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {quoteItems.map((item) => (
              <div key={item.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">
                      {item.item?.item_code || item.item_code || 'Item'}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {item.item?.description || item.item_description || 'No description'}
                    </p>
                  </div>
                  {item.allocated_customer_amount && (
                    <Badge variant="secondary">
                      {formatCurrency(item.allocated_customer_amount)}
                    </Badge>
                  )}
                </div>

                {item.damage_description && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-3">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                      Repair Needed:
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {item.damage_description}
                    </p>
                  </div>
                )}

                {item.notes_public && (
                  <p className="text-sm text-muted-foreground">
                    {item.notes_public}
                  </p>
                )}

                {item.damage_photos && item.damage_photos.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <MaterialIcon name="image" size="sm" />
                      Photos ({item.damage_photos.length})
                    </p>
                    <ScrollArea className="w-full">
                      <div className="flex gap-2 pb-2">
                        {item.damage_photos.map((photo, i) => (
                          <a
                            key={i}
                            href={photo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                          >
                            <img
                              src={photo}
                              alt={`Photo ${i + 1}`}
                              className="h-20 w-20 object-cover rounded border hover:opacity-80 transition-opacity"
                            />
                          </a>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            ))}

            {quoteItems.length === 0 && (
              <div className="text-center py-8">
                <MaterialIcon name="inventory_2" className="mx-auto text-muted-foreground mb-4" style={{ fontSize: '48px' }} />
                <p className="text-muted-foreground">No items specified</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <p className="text-sm text-muted-foreground">
                Do you approve this repair quote for{' '}
                <span className="font-medium text-foreground">
                  {formatCurrency(quote?.customer_total)}
                </span>
                ?
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setShowDeclineDialog(true)}
                  disabled={submitting}
                  className="w-full sm:w-auto"
                >
                  <MaterialIcon name="cancel" size="sm" className="mr-2" />
                  Decline Quote
                </Button>
                <Button
                  size="lg"
                  onClick={() => setShowAcceptDialog(true)}
                  disabled={submitting}
                  className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                >
                  <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                  Accept Quote
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4 space-y-1">
          <p>This is a secure, time-limited link.</p>
          {tokenData?.expires_at && (
            <p>
              Expires: {format(new Date(tokenData.expires_at), 'MMMM d, yyyy h:mm a')}
            </p>
          )}
          <p>Questions? Contact the warehouse directly for assistance.</p>
        </div>
      </div>

      {/* Accept Confirmation Dialog */}
      <AlertDialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept This Quote?</AlertDialogTitle>
            <AlertDialogDescription>
              By accepting, you authorize the repair work at a cost of{' '}
              <span className="font-medium text-foreground">
                {formatCurrency(quote?.customer_total)}
              </span>
              . This amount will be added to your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAccept}
              disabled={submitting}
              className="bg-green-600 hover:bg-green-700"
            >
              {submitting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Yes, Accept Quote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Decline Confirmation Dialog */}
      <AlertDialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline This Quote?</AlertDialogTitle>
            <AlertDialogDescription>
              If you decline, the repair work will not proceed. You can provide a
              reason to help us understand your decision.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="decline-reason">Reason (optional)</Label>
            <Textarea
              id="decline-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Please let us know why you're declining..."
              className="mt-2"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDecline}
              disabled={submitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {submitting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Decline Quote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
