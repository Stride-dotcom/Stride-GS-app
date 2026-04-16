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
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { parseFileToRows, canonicalizeHeader, parseNumber } from '@/lib/importUtils';

interface ShipmentItemsImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  itemTypes: { id: string; name: string }[];
  onImport: (items: ParsedShipmentItem[]) => void;
}

export interface ParsedShipmentItem {
  quantity: number;
  vendor: string;
  description: string;
  item_type_id: string;
  sidemark: string;
  declared_value: number | null;
}

interface EditableItem extends ParsedShipmentItem {
  _id: number;
  _hasError: boolean;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

// Header aliases for shipment item imports
const SHIPMENT_ITEM_HEADER_ALIASES: Record<string, string> = {
  quantity: 'quantity',
  qty: 'quantity',
  count: 'quantity',
  number: 'quantity',
  vendor: 'vendor',
  vendor_name: 'vendor',
  supplier: 'vendor',
  manufacturer: 'vendor',
  description: 'description',
  item_description: 'description',
  desc: 'description',
  item_type: 'item_type',
  type: 'item_type',
  category: 'item_type',
  item_type_name: 'item_type',
  sidemark: 'sidemark',
  side_mark: 'sidemark',
  mark: 'sidemark',
  tag: 'sidemark',
  label: 'sidemark',
  declared_value: 'declared_value',
  declaredvalue: 'declared_value',
  value: 'declared_value',
  dv: 'declared_value',
  insured_value: 'declared_value',
  coverage_value: 'declared_value',
};

export function ShipmentItemsImportDialog({
  open,
  onOpenChange,
  file,
  itemTypes,
  onImport,
}: ShipmentItemsImportDialogProps) {
  const { toast } = useToast();
  const [parsing, setParsing] = useState(false);
  const [editableItems, setEditableItems] = useState<EditableItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (open && file) {
      parseFile(file);
    } else {
      setEditableItems([]);
      setParseErrors([]);
      setImportResult(null);
    }
  }, [open, file]);

  const parseFile = async (file: File) => {
    setParsing(true);
    setEditableItems([]);
    setParseErrors([]);
    setImportResult(null);

    try {
      const { headers, rows } = await parseFileToRows(file);

      if (rows.length === 0) {
        setParseErrors(['No data rows found in file']);
        setParsing(false);
        return;
      }

      // Map headers to field names
      const mappedHeaders = headers.map((h) => {
        const canonical = canonicalizeHeader(h);
        return SHIPMENT_ITEM_HEADER_ALIASES[canonical] || null;
      });

      // Check for required headers
      if (!mappedHeaders.includes('vendor')) {
        setParseErrors(['Missing required column: Vendor']);
        setParsing(false);
        return;
      }

      const items: EditableItem[] = [];
      const errors: string[] = [];
      let successCount = 0;
      let failedCount = 0;

      // Create a map of item type names to IDs (case-insensitive)
      const itemTypeMap = new Map<string, string>();
      itemTypes.forEach((type) => {
        itemTypeMap.set(type.name.toLowerCase(), type.id);
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // Account for 1-based indexing and header row

        try {
          const item: Record<string, unknown> = {};
          mappedHeaders.forEach((field, colIdx) => {
            if (field && row[colIdx] !== undefined) {
              item[field] = row[colIdx];
            }
          });

          // Parse quantity
          const quantity = parseNumber(item.quantity) || 1;
          if (quantity < 1) {
            throw new Error('Quantity must be at least 1');
          }

          // Get vendor (required)
          const vendor = String(item.vendor || '').trim();
          if (!vendor) {
            throw new Error('Vendor is required');
          }

          // Get description
          const description = String(item.description || '').trim();

          // Get sidemark
          const sidemark = String(item.sidemark || '').trim();

          // Match item type by name
          let itemTypeId = '';
          if (item.item_type) {
            const typeName = String(item.item_type).trim().toLowerCase();
            if (typeName && itemTypeMap.has(typeName)) {
              itemTypeId = itemTypeMap.get(typeName) || '';
            }
          }

          // Parse declared value
          const rawDv = parseNumber(item.declared_value);
          const declaredValue = rawDv != null && rawDv > 0 ? rawDv : null;

          items.push({
            _id: i,
            _hasError: false,
            quantity,
            vendor,
            description,
            item_type_id: itemTypeId,
            sidemark,
            declared_value: declaredValue,
          });
          successCount++;
        } catch (error: unknown) {
          failedCount++;
          const message = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Row ${rowNum}: ${message}`);
        }
      }

      setEditableItems(items);
      setParseErrors(errors);
      setImportResult({
        success: successCount,
        failed: failedCount,
        errors: errors.slice(0, 10), // Limit displayed errors
      });
    } catch (error) {
      console.error('Error parsing file:', error);
      setParseErrors(['Failed to parse file. Please check the format.']);
    } finally {
      setParsing(false);
    }
  };

  const updateItem = (id: number, field: keyof ParsedShipmentItem, value: string | number | null) => {
    setEditableItems(prev => prev.map(item => {
      if (item._id === id) {
        const updated = { ...item, [field]: value };
        // Validate: vendor is required
        updated._hasError = !updated.vendor.trim();
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id: number) => {
    setEditableItems(prev => prev.filter(item => item._id !== id));
  };

  const handleImport = () => {
    // Validate all items
    const validItems = editableItems.filter(item => item.vendor.trim());
    const invalidCount = editableItems.length - validItems.length;

    if (validItems.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No valid items',
        description: 'All items are missing required vendor field.',
      });
      return;
    }

    // Convert to ParsedShipmentItem format (strip internal fields)
    const itemsToImport: ParsedShipmentItem[] = validItems.map(({ quantity, vendor, description, item_type_id, sidemark, declared_value }) => ({
      quantity,
      vendor,
      description,
      item_type_id,
      sidemark,
      declared_value,
    }));

    onImport(itemsToImport);
    
    if (invalidCount === 0) {
      toast({
        title: 'Import Successful',
        description: `Successfully added ${validItems.length} items.`,
      });
    } else {
      toast({
        variant: 'default',
        title: 'Partial Import',
        description: `Added ${validItems.length} items. ${invalidCount} items were skipped due to missing vendor.`,
      });
    }
    
    onOpenChange(false);
  };

  const validItemCount = editableItems.filter(item => item.vendor.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Import Shipment Items</DialogTitle>
          <DialogDescription>
            Review and edit items before importing. Required field: Vendor
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {parsing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                <span>Parsing file...</span>
              </div>
              <Progress value={50} />
            </div>
          )}

          {!parsing && parseErrors.length > 0 && editableItems.length === 0 && (
            <div className="rounded-md bg-destructive/10 p-4">
              <div className="flex items-start gap-2">
                <MaterialIcon name="warning" size="md" className="text-destructive mt-0.5" />
                <div>
                  <p className="font-medium text-destructive">Error parsing file</p>
                  <ul className="mt-2 text-sm text-destructive/80 list-disc list-inside">
                    {parseErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {!parsing && importResult && editableItems.length > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 p-4 border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="check_circle" size="md" className="text-green-600" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-200">Ready to import</p>
                      <p className="text-sm text-green-600 dark:text-green-400">{validItemCount} items</p>
                    </div>
                  </div>
                </div>

                {importResult.failed > 0 && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-4 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="warning" size="md" className="text-amber-600" />
                      <div>
                        <p className="font-medium text-amber-800 dark:text-amber-200">Parse Errors</p>
                        <p className="text-sm text-amber-600 dark:text-amber-400">{importResult.failed} rows had issues</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Editable Preview Table */}
              <ScrollArea className="h-[400px] rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow>
                      <TableHead className="w-20">Qty</TableHead>
                      <TableHead className="w-48">Vendor *</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-40">Class</TableHead>
                      <TableHead className="w-32">Sidemark</TableHead>
                      <TableHead className="w-28">Declared Value</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {editableItems.map((item) => (
                      <TableRow key={item._id} className={item._hasError ? 'bg-destructive/10' : ''}>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateItem(item._id, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-16 h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.vendor}
                            onChange={(e) => updateItem(item._id, 'vendor', e.target.value)}
                            placeholder="Required"
                            className={`h-8 ${!item.vendor.trim() ? 'border-destructive' : ''}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(item._id, 'description', e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={item.item_type_id || 'none'}
                            onValueChange={(value) => updateItem(item._id, 'item_type_id', value === 'none' ? '' : value)}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue placeholder="Select class" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {itemTypes.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.sidemark}
                            onChange={(e) => updateItem(item._id, 'sidemark', e.target.value)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={item.declared_value ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                updateItem(item._id, 'declared_value', null);
                                return;
                              }
                              const parsed = parseFloat(raw);
                              updateItem(item._id, 'declared_value', Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                            }}
                            placeholder="$0.00"
                            className="h-8 w-24"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem(item._id)}
                          >
                            <MaterialIcon name="delete" size="sm" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsing || validItemCount === 0}
          >
            {parsing && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Import {validItemCount} Items
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
