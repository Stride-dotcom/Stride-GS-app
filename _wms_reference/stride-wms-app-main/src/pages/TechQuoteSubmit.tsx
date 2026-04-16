import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import {
  useTechQuoteSubmission,
  TechQuoteSubmission,
} from '@/hooks/useRepairQuotes';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';

export default function TechQuoteSubmit() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const {
    loading,
    error,
    tokenData,
    quote,
    quoteItems,
    submitting,
    submitQuote,
    declineJob,
  } = useTechQuoteSubmission(token);

  const [formData, setFormData] = useState<TechQuoteSubmission>({
    labor_hours: 0,
    labor_rate: 0,
    materials_cost: 0,
    notes: '',
  });

  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [declined, setDeclined] = useState(false);

  const calculateTotal = () => {
    return (formData.labor_hours * formData.labor_rate) + formData.materials_cost;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.labor_hours <= 0 && formData.materials_cost <= 0) {
      return; // Form validation should catch this
    }

    const success = await submitQuote(formData);
    if (success) {
      setSubmitted(true);
    }
  };

  const handleDecline = async () => {
    const success = await declineJob(declineReason);
    if (success) {
      setDeclined(true);
      setShowDeclineDialog(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading quote request...</p>
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
            <CardTitle>Access Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              If you believe this is an error, please contact the warehouse.
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Submitted success state
  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <MaterialIcon name="check_circle" size="lg" className="text-green-600" />
            </div>
            <CardTitle>Quote Submitted</CardTitle>
            <CardDescription>
              Thank you! Your quote has been submitted successfully.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-2xl font-bold text-primary">
                ${calculateTotal().toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">Total Quote Amount</p>
            </div>
            <p className="text-sm text-muted-foreground">
              The warehouse will review your quote and notify you of any updates.
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
            <CardTitle>Job Declined</CardTitle>
            <CardDescription>
              You have declined this repair job.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              The warehouse has been notified. Thank you for your response.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <MaterialIcon name="build" size="md" className="text-primary" />
              </div>
              <div className="flex-1">
                <CardTitle>Repair Quote Request</CardTitle>
                <CardDescription>
                  {tokenData?.recipient_name
                    ? `Hello, ${tokenData.recipient_name}`
                    : 'Repair Technician'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 text-sm">
              {quote?.account && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Account:</span>
                  <Badge variant="outline">{quote.account.name}</Badge>
                </div>
              )}
              {quote?.sidemark && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Project:</span>
                  <Badge variant="outline">{quote.sidemark.name}</Badge>
                </div>
              )}
              {tokenData?.expires_at && (
                <div className="flex items-center gap-2">
                  <MaterialIcon name="schedule" size="sm" className="text-muted-foreground" />
                  <span>
                    Expires: {format(new Date(tokenData.expires_at), 'MMM d, yyyy')}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Items to Repair */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="inventory_2" size="md" />
              Items for Repair ({quoteItems.length})
            </CardTitle>
            <CardDescription>
              Review the items below and provide your repair estimate
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {quoteItems.map((item) => (
              <div key={item.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium">
                      {item.item?.item_code || item.item_code || 'Unknown Item'}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {item.item?.description || item.item_description || 'No description'}
                    </p>
                  </div>
                  {item.item?.status && (
                    <Badge variant="outline" className="capitalize">
                      {item.item.status.replace('_', ' ')}
                    </Badge>
                  )}
                </div>

                {item.damage_description && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Damage Notes:
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {item.damage_description}
                    </p>
                  </div>
                )}

                {item.damage_photos && item.damage_photos.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2 flex items-center gap-2">
                      <MaterialIcon name="image" size="sm" />
                      Photos ({item.damage_photos.length})
                    </p>
                    <ScrollArea className="w-full">
                      <div className="flex gap-3 pb-2">
                        {item.damage_photos.map((photo, index) => (
                          <a
                            key={index}
                            href={photo}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                          >
                            <img
                              src={photo}
                              alt={`Damage photo ${index + 1}`}
                              className="h-24 w-24 object-cover rounded-lg border hover:opacity-80 transition-opacity"
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
                <MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No items specified</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quote Form */}
        <Card>
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="calculate" size="md" />
                Your Quote
              </CardTitle>
              <CardDescription>
                Enter your repair estimate below
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Labor Hours */}
                <div className="space-y-2">
                  <Label htmlFor="labor_hours">
                    Estimated Labor Hours <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="labor_hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={formData.labor_hours || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        labor_hours: parseFloat(e.target.value) || 0,
                      })
                    }
                    placeholder="0"
                    required
                  />
                </div>

                {/* Labor Rate */}
                <div className="space-y-2">
                  <Label htmlFor="labor_rate">
                    Your Hourly Rate ($) <span className="text-destructive">*</span>
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="labor_rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.labor_rate || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          labor_rate: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="pl-8"
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>

                {/* Materials Cost */}
                <div className="space-y-2">
                  <Label htmlFor="materials_cost">Materials Cost ($)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="materials_cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.materials_cost || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          materials_cost: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="pl-8"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              {/* Total Calculation */}
              <div className="bg-muted rounded-lg p-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Labor:</span>
                    <span>
                      {formData.labor_hours} hrs × ${formData.labor_rate.toFixed(2)} ={' '}
                      <span className="font-medium">
                        ${(formData.labor_hours * formData.labor_rate).toFixed(2)}
                      </span>
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Materials:</span>
                    <span className="font-medium">
                      ${formData.materials_cost.toFixed(2)}
                    </span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between">
                    <span className="font-medium">Total Quote:</span>
                    <span className="text-xl font-bold text-primary">
                      ${calculateTotal().toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Additional Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Any additional details about the repair, materials needed, timeline, etc."
                  rows={4}
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDeclineDialog(true)}
                disabled={submitting}
                className="w-full sm:w-auto"
              >
                <MaterialIcon name="cancel" size="sm" className="mr-2" />
                Decline Job
              </Button>
              <Button
                type="submit"
                disabled={submitting || calculateTotal() <= 0}
                className="w-full sm:w-auto sm:ml-auto"
              >
                {submitting ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="send" size="sm" className="mr-2" />
                )}
                Submit Quote
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4">
          <p>This is a secure, time-limited access link.</p>
          {tokenData?.expires_at && (
            <p>
              Expires: {format(new Date(tokenData.expires_at), 'MMM d, yyyy h:mm a')}
            </p>
          )}
        </div>
      </div>

      {/* Decline Confirmation Dialog */}
      <AlertDialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline This Job?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to decline this repair job? The warehouse will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="decline-reason">Reason (optional)</Label>
            <Textarea
              id="decline-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Let them know why you're declining..."
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
              Decline Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
