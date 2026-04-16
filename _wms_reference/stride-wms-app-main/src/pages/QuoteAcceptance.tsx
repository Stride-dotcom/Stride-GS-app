import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Quote, QuoteClassLine, QuoteSelectedService, QUOTE_STATUS_CONFIG } from '@/lib/quotes/types';
import { formatCurrency } from '@/lib/quotes/calculator';
import { StatusIndicator } from '@/components/ui/StatusIndicator';

interface QuoteDetails extends Quote {
  quote_class_lines: (QuoteClassLine & {
    quote_class?: { name: string; description: string };
  })[];
  quote_selected_services: (QuoteSelectedService & {
    quote_service?: { charge_name: string; category: string; input_mode: string };
  })[];
  tenant?: { name: string; logo_url?: string };
}

export default function QuoteAcceptance() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<QuoteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing quote token');
      setLoading(false);
      return;
    }
    fetchQuote();
  }, [token]);

  const fetchQuote = async () => {
    try {
      // Use a definer RPC to fetch by token without broad anon table-read access.
      const { data: quoteData, error: quoteError } = await (supabase as any).rpc('get_quote_by_magic_link', {
        p_magic_link_token: token,
      });

      if (quoteError || !quoteData) {
        setError('Quote not found or link has expired');
        setLoading(false);
        return;
      }

      // Check if quote is expired
      if (quoteData.expiration_date && new Date(quoteData.expiration_date) < new Date()) {
        setError('This quote has expired. Please contact the warehouse for a new quote.');
        setLoading(false);
        return;
      }

      // Check quote status
      if (quoteData.status === 'void') {
        setError('This quote has been voided and is no longer valid.');
        setLoading(false);
        return;
      }

      setQuote(quoteData as QuoteDetails);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching quote:', err);
      setError('Failed to load quote. Please try again later.');
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!quote || !token) return;

    setProcessing(true);
    try {
      const { data, error } = await (supabase as any).rpc('respond_to_quote_magic_link', {
        p_magic_link_token: token,
        p_response: 'accepted',
        p_decline_reason: null,
      });
      if (error) throw error;

      const resolvedStatus = data?.status;
      const finalStatus = resolvedStatus === 'accepted' || resolvedStatus === 'declined' ? resolvedStatus : 'accepted';
      const alreadyProcessed = data?.already_processed === true;
      if (finalStatus === 'accepted') {
        setSuccessMessage(
          alreadyProcessed
            ? 'This quote was already accepted. Thank you for your response.'
            : 'Thank you! Your quote has been accepted. We will be in touch shortly.'
        );
      } else {
        setSuccessMessage('This quote was already declined and can no longer be accepted.');
      }
      setQuote({ ...quote, status: finalStatus });
    } catch (err) {
      console.error('Error accepting quote:', err);
      setError('Failed to accept quote. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!quote || !token || !declineReason.trim()) return;

    setProcessing(true);
    try {
      const { data, error } = await (supabase as any).rpc('respond_to_quote_magic_link', {
        p_magic_link_token: token,
        p_response: 'declined',
        p_decline_reason: declineReason.trim(),
      });
      if (error) throw error;

      setDeclineDialogOpen(false);
      const resolvedStatus = data?.status;
      const finalStatus = resolvedStatus === 'accepted' || resolvedStatus === 'declined' ? resolvedStatus : 'declined';
      const alreadyProcessed = data?.already_processed === true;
      if (finalStatus === 'declined') {
        setSuccessMessage(
          alreadyProcessed
            ? 'This quote was already declined. Thank you for your response.'
            : 'Quote has been declined. Thank you for your response.'
        );
      } else {
        setSuccessMessage('This quote was already accepted and can no longer be declined.');
      }
      setQuote({
        ...quote,
        status: finalStatus,
        decline_reason: finalStatus === 'declined' ? declineReason.trim() : quote.decline_reason,
      });
    } catch (err) {
      console.error('Error declining quote:', err);
      setError('Failed to decline quote. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const getBillingUnitLabel = (unit: string) => {
    switch (unit) {
      case 'per_piece':
        return 'per piece';
      case 'per_day':
        return 'per day';
      case 'per_hour':
        return 'per hour';
      case 'flat':
        return 'flat rate';
      case 'per_line_item':
        return 'per line item';
      case 'per_class':
        return 'per class';
      default:
        return unit;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading quote...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <MaterialIcon name="warning" size="xl" className="text-destructive mx-auto mb-2" />
            <CardTitle>Unable to Load Quote</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-center text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!quote) return null;

  const isActionable = quote.status === 'sent';
  const showSuccessState = quote.status === 'accepted' || quote.status === 'declined';

  // Calculate discount amount
  const discountAmount = (quote.subtotal_before_discounts || 0) - (quote.subtotal_after_discounts || 0);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {quote.tenant?.logo_url ? (
            <img
              src={quote.tenant.logo_url}
              alt={quote.tenant.name}
              className="h-16 mx-auto mb-4"
            />
          ) : (
            <MaterialIcon name="business" size="xl" className="text-primary mx-auto mb-4" />
          )}
          <h1 className="text-2xl font-bold">{quote.tenant?.name || 'Warehouse Services'}</h1>
          <p className="text-muted-foreground">Quote #{quote.quote_number}</p>
        </div>

        {/* Success Message */}
        {successMessage && (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
            <AlertDescription className="text-green-800">{successMessage}</AlertDescription>
          </Alert>
        )}

        {/* Status Banner */}
        {showSuccessState && !successMessage && (
          <Alert className={`mb-6 ${quote.status === 'accepted' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            {quote.status === 'accepted' ? (
              <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
            ) : (
              <MaterialIcon name="cancel" size="sm" className="text-gray-600" />
            )}
            <AlertDescription className={quote.status === 'accepted' ? 'text-green-800' : 'text-gray-700'}>
              {quote.status === 'accepted'
                ? 'This quote has been accepted.'
                : 'This quote has been declined.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Quote Details Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="description" size="md" />
                  Quote Details
                </CardTitle>
                <CardDescription>
                  Created on {new Date(quote.created_at).toLocaleDateString()}
                </CardDescription>
              </div>
              <StatusIndicator status={quote.status} label={QUOTE_STATUS_CONFIG[quote.status]?.label} size="sm" />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <MaterialIcon name="business" size="md" className="text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Account</p>
                  <p className="font-medium">{quote.account?.account_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <MaterialIcon name="calendar_today" size="md" className="text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Valid Until</p>
                  <p className="font-medium">
                    {quote.expiration_date
                      ? new Date(quote.expiration_date).toLocaleDateString()
                      : 'No expiration'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <MaterialIcon name="schedule" size="md" className="text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Storage Duration</p>
                  <p className="font-medium">{quote.storage_days || 0} days</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Items/Classes */}
            {quote.quote_class_lines && quote.quote_class_lines.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <MaterialIcon name="inventory_2" size="sm" />
                  Items by Size Class
                </h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3 font-medium">Size Class</th>
                        <th className="text-right p-3 font-medium">Quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.quote_class_lines.map((line) => (
                        <tr key={line.id} className="border-t">
                          <td className="p-3">
                            <div>
                              <p className="font-medium">{line.quote_class?.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {line.quote_class?.description}
                              </p>
                            </div>
                          </td>
                          <td className="p-3 text-right">{line.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Services */}
            {quote.quote_selected_services && quote.quote_selected_services.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <MaterialIcon name="description" size="sm" />
                  Services
                </h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3 font-medium">Service</th>
                        <th className="text-left p-3 font-medium">Details</th>
                        <th className="text-right p-3 font-medium">Rate</th>
                        <th className="text-right p-3 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quote.quote_selected_services.map((service) => (
                        <tr key={service.id} className="border-t">
                          <td className="p-3">
                            <div>
                              <p className="font-medium">{service.quote_service?.charge_name}</p>
                              <p className="text-xs text-muted-foreground">
                                {service.quote_service?.category}
                              </p>
                            </div>
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {service.computed_billable_qty && service.computed_billable_qty > 1 && (
                              <span className="text-xs ml-2">× {service.computed_billable_qty}</span>
                            )}
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            {formatCurrency(service.applied_rate_amount)}{' '}
                            <span className="text-xs">
                              {getBillingUnitLabel(service.quote_service?.input_mode || '')}
                            </span>
                          </td>
                          <td className="p-3 text-right font-medium">
                            {formatCurrency(service.line_total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Separator />

            {/* Totals */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(quote.subtotal_before_discounts || 0, quote.currency)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-green-600">
                  <span>Discount</span>
                  <span>-{formatCurrency(discountAmount, quote.currency)}</span>
                </div>
              )}
              {(quote.tax_amount || 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Tax ({((quote.tax_rate_percent || 0)).toFixed(1)}%)
                  </span>
                  <span>{formatCurrency(quote.tax_amount || 0, quote.currency)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="flex items-center gap-1">
                  <MaterialIcon name="attach_money" size="md" />
                  {formatCurrency(quote.grand_total || 0, quote.currency)}
                </span>
              </div>
            </div>

            {/* Notes */}
            {quote.notes && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-2">Notes</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.notes}</p>
                </div>
              </>
            )}
          </CardContent>

          {/* Action Buttons */}
          {isActionable && (
            <CardFooter className="flex flex-col sm:flex-row gap-3 bg-muted/30 border-t">
              <Button
                onClick={handleAccept}
                disabled={processing}
                className="flex-1 bg-green-600 hover:bg-green-700"
                size="lg"
              >
                {processing ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                )}
                Accept Quote
              </Button>
              <Button
                onClick={() => setDeclineDialogOpen(true)}
                disabled={processing}
                variant="outline"
                className="flex-1"
                size="lg"
              >
                <MaterialIcon name="cancel" size="sm" className="mr-2" />
                Decline Quote
              </Button>
            </CardFooter>
          )}
        </Card>

        {/* Decline Dialog */}
        <Dialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Decline Quote</DialogTitle>
              <DialogDescription>
                Please let us know why you're declining this quote. This helps us improve our services.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="decline-reason">Reason for declining</Label>
                <Textarea
                  id="decline-reason"
                  placeholder="Please provide a reason..."
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeclineDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleDecline}
                disabled={!declineReason.trim() || processing}
                variant="destructive"
              >
                {processing ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="cancel" size="sm" className="mr-2" />
                )}
                Decline Quote
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
