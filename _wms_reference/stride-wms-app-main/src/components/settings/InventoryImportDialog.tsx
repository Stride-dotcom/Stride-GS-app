import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Warehouse } from '@/hooks/useWarehouses';
import { Location } from '@/hooks/useLocations';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import ExcelJS from 'exceljs';
import { addAoaSheet, downloadWorkbook } from '@/lib/excelUtils';
import { 
  parseFileToRows, 
  canonicalizeHeader, 
  parseNumber, 
  parseBoolean,
  parseDate as parseDateUtil,
  extractUrl 
} from '@/lib/importUtils';
import {
  type ItemCustomFieldDefinition,
  type ItemColumnKey,
  type ItemDisplaySettingsV1,
  getColumnLabel,
  getViewById,
  getVisibleColumnsForView,
  parseCustomFieldColumnKey,
} from '@/lib/items/itemDisplaySettings';

interface InventoryImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  warehouses: Warehouse[];
  locations: Location[];
  itemDisplaySettings: ItemDisplaySettingsV1;
  itemDisplayViewId: string;
  onSuccess: () => void;
}

interface ParsedItem {
  quantity: number;
  boxCount?: number;
  vendor: string;
  description: string;
  itemCode: string;
  locationCode: string;
  project: string;
  room: string;
  photoUrl: string;
  inspectionNotes: string;
  assemblyStatus: string;
  itemNotes: string;
  tech: string;
  repairStatus: string;
  dateRepaired: string;
  dateReceived: string;
  dateReleased: string;
  size: number;
  customFields?: Record<string, unknown>;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
  skipped: number;
}

// Header aliases for inventory imports (canonicalized form -> field name)
const INVENTORY_HEADER_ALIASES: Record<string, keyof ParsedItem> = {
  // Quantity
  qty: 'quantity',
  quantity: 'quantity',
  
  // Box count
  box_cnt: 'boxCount',
  box_count: 'boxCount',
  boxcount: 'boxCount',
  
  // Vendor
  vendor: 'vendor',
  
  // Description
  description: 'description',
  desc: 'description',
  item_description: 'description',
  
  // Item code / ID
  id_number: 'itemCode',
  id: 'itemCode',
  item_code: 'itemCode',
  itemcode: 'itemCode',
  item_id: 'itemCode',
  sku: 'itemCode',
  
  // Location
  location: 'locationCode',
  loc: 'locationCode',
  location_code: 'locationCode',
  
  // Project
  project: 'project',
  sidemark: 'project',
  
  // Room
  room: 'room',
  
  // Photos
  photos: 'photoUrl',
  photo: 'photoUrl',
  photo_url: 'photoUrl',
  image: 'photoUrl',
  
  // Inspection notes
  inspection_notes: 'inspectionNotes',
  inspection: 'inspectionNotes',
  
  // Assembly status
  assembly_status: 'assemblyStatus',
  assembly: 'assemblyStatus',
  assm: 'assemblyStatus',
  
  // Item notes
  item_notes: 'itemNotes',
  notes: 'itemNotes',
  
  // Tech
  tech: 'tech',
  technician: 'tech',
  
  // Repair status
  repair_status: 'repairStatus',
  repair: 'repairStatus',
  
  // Dates
  date_repaired: 'dateRepaired',
  repaired: 'dateRepaired',
  date_received: 'dateReceived',
  received: 'dateReceived',
  date_released: 'dateReleased',
  released: 'dateReleased',
  
  // Size
  size: 'size',
};

function parseAssemblyStatus(value: string): string | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  if (upper.includes('NEEDS') || upper.includes('REQUIRED') || upper === 'YES') return 'pending';
  if (upper.includes('NO') || upper.includes('N/A') || upper === 'NO ASSM REQ') return 'not_required';
  if (upper.includes('COMPLETE') || upper.includes('DONE')) return 'complete';
  if (upper.includes('DO NOT')) return 'not_required';
  return null;
}

function parseRepairStatus(value: string): string | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  if (upper === 'OK' || upper === 'COMPLETE' || upper === 'DONE') return 'complete';
  if (upper.includes('NEEDS') || upper.includes('REQUIRED')) return 'pending';
  return null;
}

function buildCustomFieldHeaderMap(customFields: ItemCustomFieldDefinition[]) {
  const map = new Map<string, ItemCustomFieldDefinition>();
  for (const f of customFields) {
    if (!f.enabled) continue;
    // Allow headers by label or key (both canonicalized).
    map.set(canonicalizeHeader(f.label), f);
    map.set(canonicalizeHeader(f.key), f);
    // Common convention: "cf_<key>"
    map.set(`cf_${canonicalizeHeader(f.key)}`, f);
  }
  return map;
}

async function parseFile(
  file: File,
  customFields: ItemCustomFieldDefinition[],
): Promise<{ items: ParsedItem[]; headers: string[] }> {
  const items: ParsedItem[] = [];
  
  try {
    const { headers, rows } = await parseFileToRows(file);
    
    if (rows.length === 0) {
      return { items: [], headers: [] };
    }
    
    const customFieldMap = buildCustomFieldHeaderMap(customFields);

    // Map headers to known fields (and separately track custom field columns).
    const mappedHeaders: (keyof ParsedItem | null)[] = headers.map((h) => {
      const canonical = canonicalizeHeader(h);
      return INVENTORY_HEADER_ALIASES[canonical] || null;
    });

    const mappedCustomFieldDefs: (ItemCustomFieldDefinition | null)[] = headers.map((h) => {
      const canonical = canonicalizeHeader(h);
      // Don't double-map: if it's a known header alias, treat it as that field.
      if (INVENTORY_HEADER_ALIASES[canonical]) return null;
      return customFieldMap.get(canonical) || null;
    });
    
    // Create column indices
    const getIndex = (field: keyof ParsedItem): number => mappedHeaders.indexOf(field);
    const customFieldIndices: Array<{ key: string; type: ItemCustomFieldDefinition['type']; idx: number }> = [];
    for (let i = 0; i < mappedCustomFieldDefs.length; i++) {
      const def = mappedCustomFieldDefs[i];
      if (!def) continue;
      customFieldIndices.push({ key: def.key, type: def.type, idx: i });
    }
    
    // Parse each row
    for (const row of rows) {
      const getValue = (field: keyof ParsedItem): string => {
        const idx = getIndex(field);
        if (idx === -1) return '';
        return String(row[idx] ?? '').trim();
      };
      
      const getNumValue = (field: keyof ParsedItem): number => {
        const idx = getIndex(field);
        if (idx === -1) return 0;
        return parseNumber(row[idx]) || 0;
      };
      
      const itemCode = getValue('itemCode');
      const quantity = getNumValue('quantity');
      
      // Skip empty rows or rows without item code
      if (!itemCode && quantity === 0) continue;

      // Custom fields (metadata.custom_fields)
      const rowCustomFields: Record<string, unknown> = {};
      for (const { key, type, idx } of customFieldIndices) {
        const raw = row[idx];
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        let next: unknown = String(raw).trim();
        if (type === 'number') {
          const n = parseNumber(raw);
          next = n === null ? null : n;
        } else if (type === 'date') {
          next = parseDateUtil(raw as any);
        } else if (type === 'checkbox') {
          next = parseBoolean(raw);
        }
        if (next === null || next === undefined || next === '') continue;
        rowCustomFields[key] = next;
      }
      
      items.push({
        quantity: quantity || 1,
        boxCount: getNumValue('boxCount'),
        vendor: getValue('vendor'),
        description: getValue('description'),
        itemCode,
        locationCode: getValue('locationCode').toUpperCase(),
        project: getValue('project'),
        room: getValue('room'),
        photoUrl: getValue('photoUrl'),
        inspectionNotes: getValue('inspectionNotes'),
        assemblyStatus: getValue('assemblyStatus'),
        itemNotes: getValue('itemNotes'),
        tech: getValue('tech'),
        repairStatus: getValue('repairStatus'),
        dateRepaired: getValue('dateRepaired'),
        dateReceived: getValue('dateReceived'),
        dateReleased: getValue('dateReleased'),
        size: getNumValue('size'),
        customFields: Object.keys(rowCustomFields).length > 0 ? rowCustomFields : undefined,
      });
    }
    
    return { items, headers };
  } catch (error) {
    console.error('Error parsing inventory file:', error);
    return { items: [], headers: [] };
  }
}

export function InventoryImportDialog({
  open,
  onOpenChange,
  file,
  warehouses,
  locations,
  itemDisplaySettings,
  itemDisplayViewId,
  onSuccess,
}: InventoryImportDialogProps) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState(warehouses[0]?.id || '');
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [step, setStep] = useState<'preview' | 'importing' | 'complete'>('preview');
  const [parsing, setParsing] = useState(false);
  const { toast } = useToast();

  const templateHeaders = useMemo(() => {
    const view = getViewById(itemDisplaySettings, itemDisplayViewId) || itemDisplaySettings.views[0];
    const cols: ItemColumnKey[] = view ? getVisibleColumnsForView(view) : [];

    const headers: string[] = [];
    for (const col of cols) {
      const cfKey = parseCustomFieldColumnKey(col);
      if (cfKey) {
        headers.push(getColumnLabel(itemDisplaySettings, col));
        continue;
      }
      if (col === 'photo') {
        headers.push('Photo URL');
        continue;
      }
      headers.push(getColumnLabel(itemDisplaySettings, col));
    }

    // Ensure a minimally useful template even if settings are missing.
    if (headers.length === 0) {
      return ['Item Code', 'Description', 'Vendor', 'Location', 'Qty'];
    }

    // Make sure Item Code is first so header aliases like "SKU" can't accidentally
    // take precedence over it during parsing.
    const itemCodeIdx = headers.findIndex((h) => canonicalizeHeader(h) === 'item_code');
    if (itemCodeIdx === -1) {
      headers.unshift('Item Code');
    } else if (itemCodeIdx > 0) {
      const [h] = headers.splice(itemCodeIdx, 1);
      headers.unshift(h);
    }

    // De-dupe while preserving order
    const seen = new Set<string>();
    return headers.filter((h) => {
      const key = canonicalizeHeader(h);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [itemDisplaySettings, itemDisplayViewId]);

  const downloadCsvTemplate = () => {
    const escape = (v: string) => {
      const s = String(v ?? '');
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const csv = `${templateHeaders.map(escape).join(',')}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-import-template-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadExcelTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    addAoaSheet(wb, [templateHeaders], 'Template');
    await downloadWorkbook(wb, `inventory-import-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Create a location lookup map
  const locationMap = new Map<string, string>();
  locations.forEach(loc => {
    locationMap.set(loc.code.toUpperCase(), loc.id);
  });

  useEffect(() => {
    if (warehouses.length > 0 && !selectedWarehouse) {
      setSelectedWarehouse(warehouses[0].id);
    }
  }, [warehouses, selectedWarehouse]);

  useEffect(() => {
    if (open && file && parsedItems.length === 0 && !parsing) {
      handleFileRead();
    }
  }, [open, file]);

  const handleFileRead = async () => {
    if (!file) return;
    
    setParsing(true);
    try {
      const { items, headers: parsedHeaders } = await parseFile(file, itemDisplaySettings.custom_fields);
      setParsedItems(items);
      setHeaders(parsedHeaders);
      
      if (items.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Import Error',
          description: 'No valid items found in the file. Check that columns like ID#, Description, etc. are present.',
        });
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to parse the file. Please check the format.',
      });
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!selectedWarehouse || parsedItems.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please select a warehouse and ensure there are items to import.',
      });
      return;
    }

    // Get tenant_id from the current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'You must be logged in to import items.',
      });
      return;
    }

    const { data: profile } = await supabase
      .from('users')
      .select('tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not determine your organization.',
      });
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    const batchSize = 25;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    try {
      for (let i = 0; i < parsedItems.length; i += batchSize) {
        const batch = parsedItems.slice(i, i + batchSize);
        
        const insertData = batch
          .filter(item => item.itemCode) // Skip items without item code
          .map((item) => {
            const locationId = locationMap.get(item.locationCode);
            const photoUrl = extractUrl(item.photoUrl);
            const custom_fields =
              item.customFields && Object.keys(item.customFields).length > 0 ? item.customFields : null;
            
            return {
              tenant_id: profile.tenant_id,
              warehouse_id: selectedWarehouse,
              item_code: item.itemCode,
              description: item.description || null,
              vendor: item.vendor || null,
              quantity: item.quantity || 1,
              size: item.size || null,
              current_location_id: locationId || null,
              sidemark: item.project || null,
              status: item.dateReleased ? 'released' : 'active',
              assembly_status: parseAssemblyStatus(item.assemblyStatus),
              repair_status: parseRepairStatus(item.repairStatus),
              received_at: parseDateUtil(item.dateReceived),
              primary_photo_url: photoUrl,
              photo_urls: photoUrl ? [photoUrl] : null,
              metadata: {
                room: item.room || null,
                box_count: item.boxCount || null,
                inspection_notes: item.inspectionNotes || null,
                item_notes: item.itemNotes || null,
                tech: item.tech || null,
                date_repaired: item.dateRepaired || null,
                date_released: item.dateReleased || null,
                ...(custom_fields ? { custom_fields: custom_fields as Record<string, string | number | boolean | null> } : {}),
                imported_from: file?.name || 'excel_import',
              } as Record<string, unknown>,
            };
          });

        skippedCount += batch.length - insertData.length;

        if (insertData.length === 0) {
          setProgress(Math.round(((i + batch.length) / parsedItems.length) * 100));
          continue;
        }

        const { data, error } = await (supabase as any)
          .from('items')
          .upsert(insertData, { onConflict: 'tenant_id,item_code', ignoreDuplicates: false })
          .select();

        if (error) {
          failedCount += insertData.length;
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          successCount += data?.length || 0;
          failedCount += insertData.length - (data?.length || 0);
        }

        setProgress(Math.round(((i + batch.length) / parsedItems.length) * 100));
      }

      setResult({ success: successCount, failed: failedCount, errors, skipped: skippedCount });
      setStep('complete');

      // Show accurate toast based on actual results
      if (successCount > 0 && failedCount === 0) {
        toast({
          title: 'Import Complete',
          description: `Successfully imported ${successCount} item${successCount !== 1 ? 's' : ''}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}.`,
        });
        onSuccess();
      } else if (successCount > 0 && failedCount > 0) {
        toast({
          variant: 'default',
          title: 'Import Partially Complete',
          description: `Imported ${successCount} item${successCount !== 1 ? 's' : ''}, ${failedCount} failed${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}.`,
        });
        onSuccess();
      } else {
        toast({
          variant: 'destructive',
          title: 'Import Failed',
          description: `Failed to import items. ${errors.length > 0 ? errors[0] : 'Please check the file format.'}`,
        });
      }
    } catch (error) {
      console.error('Import error:', error);
      setResult({ success: 0, failed: parsedItems.length, errors: ['An unexpected error occurred'], skipped: 0 });
      setStep('complete');
      toast({
        variant: 'destructive',
        title: 'Import Failed',
        description: 'An unexpected error occurred during import.',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setStep('preview');
    setProgress(0);
    setResult(null);
    setParsedItems([]);
    setHeaders([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Inventory</DialogTitle>
          <DialogDescription>
            {step === 'preview' && 'Review the items to be imported.'}
            {step === 'importing' && 'Importing inventory items...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium">Target Warehouse</label>
                  <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                    <SelectTrigger className="w-full mt-1">
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((wh) => (
                        <SelectItem key={wh.id} value={wh.id}>
                          {wh.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 sm:pb-0">
                  <Button variant="outline" size="sm" onClick={downloadCsvTemplate}>
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    CSV Template
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadExcelTemplate}>
                    <MaterialIcon name="grid_on" size="sm" className="mr-2" />
                    Excel Template
                  </Button>
                </div>
              </div>

              <div className="bg-muted rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Items found:</span>
                  <span className="text-2xl font-bold">
                    {parsing ? <MaterialIcon name="progress_activity" size="md" className="animate-spin" /> : parsedItems.length}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  File: {file?.name}
                </p>
                {headers.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Columns detected: {headers.filter(h => h).slice(0, 6).join(', ')}
                    {headers.filter(h => h).length > 6 && '...'}
                  </p>
                )}
              </div>

              {parsedItems.length > 0 && (
                <ScrollArea className="h-[250px] border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2">ID#</th>
                        <th className="text-left p-2">Description</th>
                        <th className="text-left p-2">Vendor</th>
                        <th className="text-left p-2">Location</th>
                        <th className="text-left p-2">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedItems.slice(0, 20).map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2 font-mono text-xs">{item.itemCode}</td>
                          <td className="p-2 max-w-[150px] truncate">{item.description}</td>
                          <td className="p-2 max-w-[100px] truncate">{item.vendor}</td>
                          <td className="p-2 font-mono text-xs">
                            {item.locationCode}
                            {item.locationCode && !locationMap.has(item.locationCode) && (
                              <span className="text-amber-500 ml-1" title="Location not found">⚠</span>
                            )}
                          </td>
                          <td className="p-2">{item.quantity}</td>
                        </tr>
                      ))}
                      {parsedItems.length > 20 && (
                        <tr className="border-t">
                          <td colSpan={5} className="p-2 text-muted-foreground text-center">
                            ... and {parsedItems.length - 20} more
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ScrollArea>
              )}

              {parsedItems.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  ⚠ Items with unrecognized locations will be imported without a location assignment.
                </p>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                <MaterialIcon name="progress_activity" size="md" className="animate-spin text-primary" />
                <span>Importing items...</span>
              </div>
              <Progress value={progress} />
              <p className="text-sm text-muted-foreground text-center">
                {progress}% complete
              </p>
            </div>
          )}

          {step === 'complete' && result && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3 text-green-600">
                <MaterialIcon name="check_circle" size="md" />
                <span className="font-medium">{result.success} items imported successfully</span>
              </div>
              {result.skipped > 0 && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <MaterialIcon name="warning" size="md" />
                  <span>{result.skipped} items skipped (no item code)</span>
                </div>
              )}
              {result.failed > 0 && (
                <div className="flex items-center gap-3 text-amber-600">
                  <MaterialIcon name="warning" size="md" />
                  <span>{result.failed} items failed to import</span>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="bg-red-50 dark:bg-red-950 rounded-md p-3 max-h-[100px] overflow-auto">
                  {result.errors.map((err, i) => (
                    <p key={i} className="text-sm text-red-600">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={parsedItems.length === 0 || parsing}>
                Import {parsedItems.length} Items
              </Button>
            </>
          )}
          {step === 'complete' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
