import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { useRepairQuotes, RepairQuote } from '@/hooks/useRepairQuotes';
import { useUsers } from '@/hooks/useUsers';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface RepairQuoteSectionProps {
  itemId: string;
  canApprove?: boolean;
}

export function RepairQuoteSection({ itemId, canApprove = true }: RepairQuoteSectionProps) {
  const { quotes, loading, createQuote, approveQuote, declineQuote } = useRepairQuotes(itemId);
  const { users } = useUsers();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    flat_rate: '',
    technician_user_id: '',
    technician_name: '',
    notes: '',
  });

  // All users can be assigned as technicians
  const technicians = users;

  const handleSubmit = async () => {
    if (!formData.flat_rate) return;

    setSubmitting(true);
    const result = await createQuote({
      flat_rate: parseFloat(formData.flat_rate),
      technician_user_id: formData.technician_user_id || undefined,
      technician_name: formData.technician_name || undefined,
      notes: formData.notes || undefined,
    });

    if (result) {
      setDialogOpen(false);
      setFormData({ flat_rate: '', technician_user_id: '', technician_name: '', notes: '' });
    }
    setSubmitting(false);
  };

  const handleApprove = async (quoteId: string) => {
    setApprovingId(quoteId);
    await approveQuote(quoteId);
    setApprovingId(null);
  };

  const handleDecline = async (quoteId: string) => {
    setApprovingId(quoteId);
    await declineQuote(quoteId);
    setApprovingId(null);
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MaterialIcon name="handyman" size="md" />
            Repair Quotes ({quotes.length})
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <MaterialIcon name="add" size="sm" className="mr-1" />
                New Quote
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Repair Quote</DialogTitle>
                <DialogDescription>
                  Add a repair quote for this item. It will require approval before work begins.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="flat_rate">Flat Rate ($) *</Label>
                  <div className="relative">
                    <MaterialIcon name="attach_money" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="flat_rate"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.flat_rate}
                      onChange={(e) => setFormData({ ...formData, flat_rate: e.target.value })}
                      placeholder="0.00"
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Technician</Label>
                  <Select
                    value={formData.technician_user_id}
                    onValueChange={(v) => setFormData({ ...formData, technician_user_id: v, technician_name: '' })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select internal technician (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="external">External Technician</SelectItem>
                      {technicians.map(tech => (
                        <SelectItem key={tech.id} value={tech.id}>
                          {tech.first_name} {tech.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {formData.technician_user_id === 'external' && (
                  <div className="space-y-2">
                    <Label htmlFor="technician_name">External Technician Name</Label>
                    <Input
                      id="technician_name"
                      value={formData.technician_name}
                      onChange={(e) => setFormData({ ...formData, technician_name: e.target.value })}
                      placeholder="Enter technician name"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Describe the repair work needed..."
                    rows={3}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={submitting || !formData.flat_rate}>
                  {submitting ? (
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  ) : null}
                  Create Quote
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No repair quotes for this item.
          </p>
        ) : (
          <div className="space-y-4">
            {quotes.map((quote) => (
              <div
                key={quote.id}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl font-bold">
                      ${quote.flat_rate?.toFixed(2)}
                    </span>
                    {getStatusBadge(quote.approval_status)}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(quote.created_at), 'MMM d, yyyy')}
                  </span>
                </div>

                {(quote.technician || quote.technician_name) && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MaterialIcon name="person" size="sm" />
                    <span>
                      {quote.technician
                        ? `${quote.technician.first_name} ${quote.technician.last_name}`
                        : quote.technician_name}
                    </span>
                  </div>
                )}

                {quote.notes && (
                  <p className="text-sm text-muted-foreground">{quote.notes}</p>
                )}

                {quote.approval_status === 'pending' && canApprove && (
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(quote.id)}
                      disabled={approvingId === quote.id}
                    >
                      {approvingId === quote.id ? (
                        <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />
                      ) : (
                        <MaterialIcon name="check" size="sm" className="mr-1" />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDecline(quote.id)}
                      disabled={approvingId === quote.id}
                    >
                      <MaterialIcon name="close" size="sm" className="mr-1" />
                      Decline
                    </Button>
                  </div>
                )}

                {quote.approval_status === 'approved' && quote.approver && (
                  <p className="text-xs text-muted-foreground">
                    Approved by {quote.approver.first_name} {quote.approver.last_name} on{' '}
                    {quote.approved_at && format(new Date(quote.approved_at), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
