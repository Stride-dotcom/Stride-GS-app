import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { InvoicePreview } from '@/lib/invoiceBuilder/types';

interface InvoicePreviewCardProps {
  preview: InvoicePreview;
  isSelected: boolean;
  onSelectionChange: (selected: boolean) => void;
  onNotesChange: (notes: string) => void;
}

export function InvoicePreviewCard({
  preview,
  isSelected,
  onSelectionChange,
  onNotesChange,
}: InvoicePreviewCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Card className={isSelected ? 'ring-2 ring-primary' : ''}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardContent className="py-4">
          {/* Header Row */}
          <div className="flex items-center gap-4">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelectionChange(!!checked)}
            />

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{preview.accountName}</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {preview.accountCode}
                </Badge>
              </div>
              {preview.sidemarkName && (
                <p className="text-sm text-muted-foreground">
                  Sidemark: {preview.sidemarkName}
                </p>
              )}
              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                <span>{preview.lineItems.length} line items</span>
                <span>•</span>
                <span>{preview.chargeTypes.join(', ')}</span>
                <span>•</span>
                <span>{preview.periodStart} - {preview.periodEnd}</span>
              </div>
            </div>

            <div className="text-right">
              <p className="text-lg font-semibold">${preview.subtotal.toFixed(2)}</p>
            </div>

            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <MaterialIcon
                  name={isExpanded ? 'expand_less' : 'expand_more'}
                  size="sm"
                />
                {isExpanded ? 'Hide' : 'Show'} details
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* Expanded Content */}
          <CollapsibleContent className="mt-4">
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.lineItems.map((item) => (
                    <TableRow key={item.billingEventId}>
                      <TableCell>{item.occurredAt?.slice(0, 10) || '-'}</TableCell>
                      <TableCell>{item.description || item.chargeType}</TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">${item.unitRate.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${item.totalAmount.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4">
              <label className="text-sm font-medium">Invoice Notes (optional)</label>
              <Input
                placeholder="Add notes for this invoice..."
                value={preview.notes}
                onChange={(e) => onNotesChange(e.target.value)}
                className="mt-1"
              />
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}
