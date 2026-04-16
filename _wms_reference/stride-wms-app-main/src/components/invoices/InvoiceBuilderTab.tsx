import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useInvoiceBuilder } from '@/hooks/useInvoiceBuilder';
import { InvoiceGroupingSelector } from './InvoiceGroupingSelector';
import { InvoicePreviewList } from './InvoicePreviewList';

export function InvoiceBuilderTab() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    billingEvents,
    isLoading,
    groupBy,
    setGroupBy,
    invoicePreviews,
    selectedPreviews,
    previewCounts,
    isCreating,
    summary,
    togglePreviewSelection,
    toggleSelectAll,
    updatePreviewNotes,
    createInvoices,
    clearBuilder,
  } = useInvoiceBuilder();

  const hasEvents = billingEvents.length > 0;
  const selectedCount = selectedPreviews.size;
  const canCreate = selectedCount > 0 && !isCreating;

  const handleCreateInvoices = async () => {
    const result = await createInvoices();
    if (result.success > 0) {
      // Navigate to saved invoices tab
      setSearchParams({ subtab: 'saved' });
    }
  };

  const handleClear = () => {
    clearBuilder();
    // Navigate back to billing report
    navigate('/reports?tab=billing');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading billing events...</span>
      </div>
    );
  }

  if (!hasEvents) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <MaterialIcon name="receipt_long" className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Billing Events Selected</h3>
            <p className="text-muted-foreground mb-4">
              Go back to the Billing Report to select events for invoicing.
            </p>
            <Button onClick={() => navigate('/reports?tab=billing')}>
              <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
              Back to Billing Report
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Invoice Builder</h2>
          <p className="text-muted-foreground">Organize billing events into invoices</p>
        </div>
        <Button variant="outline" onClick={handleClear}>
          <MaterialIcon name="clear" size="sm" className="mr-2" />
          Clear
        </Button>
      </div>

      {/* Summary Card */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-6 text-sm flex-wrap">
            <div className="flex items-center gap-2">
              <MaterialIcon name="receipt" size="sm" className="text-muted-foreground" />
              <span className="font-medium">{summary.eventCount}</span>
              <span className="text-muted-foreground">billing events</span>
            </div>
            <div className="flex items-center gap-2">
              <MaterialIcon name="attach_money" size="sm" className="text-muted-foreground" />
              <span className="font-medium">${summary.total.toFixed(2)}</span>
              <span className="text-muted-foreground">total</span>
            </div>
            <div className="flex items-center gap-2">
              <MaterialIcon name="business" size="sm" className="text-muted-foreground" />
              <span className="font-medium">{summary.accountCount}</span>
              <span className="text-muted-foreground">accounts</span>
            </div>
            <div className="flex items-center gap-2">
              <MaterialIcon name="date_range" size="sm" className="text-muted-foreground" />
              <span className="text-muted-foreground">
                {summary.dateRange.start} - {summary.dateRange.end}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grouping Selector */}
      <InvoiceGroupingSelector
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        previewCounts={previewCounts}
      />

      {/* Preview List */}
      <InvoicePreviewList
        previews={invoicePreviews}
        selectedPreviews={selectedPreviews}
        onToggleSelection={togglePreviewSelection}
        onToggleSelectAll={toggleSelectAll}
        onUpdateNotes={updatePreviewNotes}
      />

      {/* Actions */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {selectedCount} of {invoicePreviews.length} invoices selected
            </span>
            <Button
              onClick={handleCreateInvoices}
              disabled={!canCreate}
              size="lg"
            >
              {isCreating ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Create {selectedCount} Invoice{selectedCount !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
