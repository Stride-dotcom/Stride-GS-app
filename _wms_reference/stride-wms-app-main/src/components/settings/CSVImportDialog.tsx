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
import { Progress } from '@/components/ui/progress';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Warehouse } from '@/hooks/useWarehouses';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parseFileToRows, canonicalizeHeader, parseNumber } from '@/lib/importUtils';
import { parseDisplayLocationType, toStoredLocationType } from '@/lib/locationTypeUtils';
import {
  LOCATION_LIST_COLUMNS,
  type LocationListColumnKey,
} from '@/lib/locationListColumns';
import type { Database } from '@/integrations/supabase/types';

interface CSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  warehouses: Warehouse[];
  onSuccess: () => void;
}

interface ParsedLocation {
  code: string;
  name: string;
  type: string;
  zoneCode: string | null; // zone_code column (optional). Use "CLEAR" to unassign.
  warehouseName: string;
  status: 'active' | 'inactive' | 'full';
  isActive: boolean;
  capacitySqFt: number | null;
  capacityCuFt: number | null;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

type LocationInsert = Database['public']['Tables']['locations']['Insert'];

const LIST_COLUMN_KEY_TO_IMPORT_FIELD: Record<LocationListColumnKey, string> = {
  code: 'code',
  name: 'name',
  type: 'type',
  zone_code: 'zone_code',
  warehouse: 'warehouse_name',
  capacity: 'capacity',
  status: 'status',
  sq_ft: 'capacity_sq_ft',
  cu_ft: 'capacity_cu_ft',
};

const LOCATION_LIST_COLUMN_ALIASES = LOCATION_LIST_COLUMNS.reduce<Record<string, string>>((acc, column) => {
  acc[canonicalizeHeader(column.label)] = LIST_COLUMN_KEY_TO_IMPORT_FIELD[column.key];
  return acc;
}, {});

// Header aliases for location imports (includes list-column labels + legacy aliases)
const LOCATION_HEADER_ALIASES: Record<string, string> = {
  ...LOCATION_LIST_COLUMN_ALIASES,
  location_name: 'code',
  location_code: 'code',
  location: 'code',
  location_type: 'type',
  zone_code: 'zone_code',
  zone: 'zone_code',
  warehouse_name: 'warehouse_name',
  capacity_cuft: 'capacity_cu_ft',
  capacity_cu_ft: 'capacity_cu_ft',
  capacity_sq_ft: 'capacity_sq_ft',
  square_feet: 'capacity_sq_ft',
  square_footage: 'capacity_sq_ft',
  cubic_feet: 'capacity_cu_ft',
  cubic_footage: 'capacity_cu_ft',
};

function detectLocationType(code: string): string {
  const upperCode = code.toUpperCase();

  if (upperCode.includes('DOCK')) {
    return 'dock';
  }

  // Legacy "zone/storage area" style location codes should map to area.
  if (
    upperCode.includes('ZONE') ||
    upperCode.includes('AREA') ||
    upperCode.includes('OVERFLOW') ||
    upperCode.includes('STAGING') ||
    upperCode.includes('RECEIVING') ||
    upperCode.includes('STORAGE') ||
    upperCode === 'IA' ||
    upperCode === 'I-J' ||
    upperCode === 'E-F' ||
    upperCode === 'G-H'
  ) {
    return 'area';
  }

  if (upperCode.startsWith('BAY-') || /^SW\d*$/.test(upperCode) || /^WW\d*$/.test(upperCode)) {
    return 'bay';
  }

  if (/^[A-Z]+RR\.\d+$/.test(upperCode) || /^[A-Z]+R\d+$/.test(upperCode)) {
    return 'row';
  }

  if (upperCode.startsWith('SHELF-') || upperCode.startsWith('SHLF-')) {
    return 'shelf';
  }

  if (/^[A-Z]\d+\.\d+[WCE]?$/.test(upperCode)) {
    return 'bin';
  }

  return 'bin';
}

async function parseFile(file: File): Promise<ParsedLocation[]> {
  const locations: ParsedLocation[] = [];
  
  try {
    const { headers, rows } = await parseFileToRows(file);
    
    if (rows.length === 0) {
      return locations;
    }
    
    // Map headers to field names
    const mappedHeaders = headers.map((h) => {
      const canonical = canonicalizeHeader(h);
      return LOCATION_HEADER_ALIASES[canonical] || null;
    });
    
    // Find the code column index (required)
    let codeIdx = mappedHeaders.indexOf('code');
    const nameIdx = mappedHeaders.indexOf('name');
    const typeIdx = mappedHeaders.indexOf('type');
    const zoneCodeIdx = mappedHeaders.indexOf('zone_code');
    const warehouseNameIdx = mappedHeaders.indexOf('warehouse_name');
    const statusIdx = mappedHeaders.indexOf('status');
    const capacityIdx = mappedHeaders.indexOf('capacity');
    const capacitySqFtIdx = mappedHeaders.indexOf('capacity_sq_ft');
    const capacityCuFtIdx = mappedHeaders.indexOf('capacity_cu_ft');
    
    // If no code column found, use first column
    if (codeIdx === -1) {
      codeIdx = 0;
    }
    
    // Parse each row
    for (const row of rows) {
      const rawCode = String(row[codeIdx] ?? '').trim();
      if (!rawCode) continue;
      
      const code = rawCode.toUpperCase();
      const name = nameIdx >= 0 ? String(row[nameIdx] ?? '').trim() : '';
      const typeValue = typeIdx >= 0 ? String(row[typeIdx] ?? '').trim().toLowerCase() : '';
      const parsedType = parseDisplayLocationType(typeValue);
      const type = parsedType || detectLocationType(code);

      const rawZoneCode = zoneCodeIdx >= 0 ? String(row[zoneCodeIdx] ?? '').trim() : '';
      const zoneCode = rawZoneCode ? rawZoneCode.toUpperCase() : null;

      const rawWarehouseName = warehouseNameIdx >= 0 ? String(row[warehouseNameIdx] ?? '').trim() : '';
      const rawStatus = statusIdx >= 0 ? String(row[statusIdx] ?? '').trim().toLowerCase() : '';
      let status: 'active' | 'inactive' | 'full' = 'active';
      let isActive = true;
      if (rawStatus === 'archived' || rawStatus === 'archive') {
        status = 'inactive';
        isActive = false;
      } else if (rawStatus === 'inactive') {
        status = 'inactive';
        isActive = false;
      } else if (rawStatus === 'full' || rawStatus === 'active') {
        status = rawStatus;
      }
      const capacitySqFt = capacitySqFtIdx >= 0 ? parseNumber(row[capacitySqFtIdx]) : null;
      const explicitCuFt = capacityCuFtIdx >= 0 ? parseNumber(row[capacityCuFtIdx]) : null;
      const fallbackCapacity = capacityIdx >= 0 ? parseNumber(row[capacityIdx]) : null;
      const capacityCuFt = explicitCuFt ?? fallbackCapacity;

      locations.push({
        code,
        name,
        type,
        zoneCode,
        warehouseName: rawWarehouseName,
        status,
        isActive,
        capacitySqFt,
        capacityCuFt,
      });
    }
  } catch (error) {
    console.error('Error parsing file:', error);
  }
  
  return locations;
}

export function CSVImportDialog({
  open,
  onOpenChange,
  file,
  warehouses,
  onSuccess,
}: CSVImportDialogProps) {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState(warehouses[0]?.id || '');
  const [parsedLocations, setParsedLocations] = useState<ParsedLocation[]>([]);
  const [step, setStep] = useState<'preview' | 'importing' | 'complete'>('preview');
  const [parsing, setParsing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (warehouses.length > 0 && !selectedWarehouse) {
      setSelectedWarehouse(warehouses[0].id);
    }
  }, [warehouses, selectedWarehouse]);

  useEffect(() => {
    if (open && file && parsedLocations.length === 0 && !parsing) {
      handleFileRead();
    }
  }, [open, file]);

  const handleFileRead = async () => {
    if (!file) return;
    
    setParsing(true);
    try {
      const locations = await parseFile(file);
      setParsedLocations(locations);
      
      if (locations.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Import Error',
          description: 'No valid locations found in the file.',
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
    if (!selectedWarehouse || parsedLocations.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please select a warehouse and ensure there are locations to import.',
      });
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    const batchSize = 50;
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    const warehouseIdByName = new Map(
      warehouses.map((warehouse) => [warehouse.name.trim().toLowerCase(), warehouse.id])
    );

    try {
      // Pre-fetch zones for any warehouses referenced by this import (only if zone codes are present).
      // This enables "zone_code" imports and the CLEAR token without per-row queries.
      const zoneIdByWarehouseAndCode = new Map<string, Map<string, string>>();
      const zoneWarehouseIds = new Set<string>();

      parsedLocations.forEach((loc) => {
        if (!loc.zoneCode) return;
        if (loc.zoneCode.toUpperCase() === 'CLEAR') return;
        const resolvedWarehouseId = loc.warehouseName
          ? warehouseIdByName.get(loc.warehouseName.trim().toLowerCase())
          : selectedWarehouse;
        if (resolvedWarehouseId) zoneWarehouseIds.add(resolvedWarehouseId);
      });

      if (zoneWarehouseIds.size > 0) {
        const { data: zoneRows, error: zoneError } = await supabase
          .from('warehouse_zones')
          .select('id, zone_code, warehouse_id')
          .in('warehouse_id', Array.from(zoneWarehouseIds));

        if (zoneError) throw zoneError;

        (zoneRows || []).forEach((z) => {
          const whId = (z as any).warehouse_id as string;
          const code = String((z as any).zone_code || '').trim().toUpperCase();
          if (!whId || !code) return;
          const inner = zoneIdByWarehouseAndCode.get(whId) ?? new Map<string, string>();
          inner.set(code, String((z as any).id));
          zoneIdByWarehouseAndCode.set(whId, inner);
        });
      }

      for (let i = 0; i < parsedLocations.length; i += batchSize) {
        const batch = parsedLocations.slice(i, i + batchSize);
        const insertData: LocationInsert[] = [];

        batch.forEach((loc, indexInBatch) => {
          const resolvedWarehouseId = loc.warehouseName
            ? warehouseIdByName.get(loc.warehouseName.trim().toLowerCase())
            : selectedWarehouse;

          if (!resolvedWarehouseId) {
            failedCount += 1;
            errors.push(
              `Row ${i + indexInBatch + 2}: Warehouse "${loc.warehouseName}" was not found.`
            );
            return;
          }

          const row: LocationInsert = {
            code: loc.code,
            type: toStoredLocationType(loc.type),
            warehouse_id: resolvedWarehouseId,
            status: loc.status,
            is_active: loc.isActive,
          };

          // Only set optional fields when provided (so blank cells do not overwrite existing values).
          if (loc.name && loc.name.trim()) {
            row.name = loc.name.trim();
          }
          if (loc.capacitySqFt != null) {
            row.capacity_sq_ft = loc.capacitySqFt;
          }
          if (loc.capacityCuFt != null) {
            row.capacity_cu_ft = loc.capacityCuFt;
            row.capacity_cuft = loc.capacityCuFt;
          }

          if (loc.zoneCode) {
            const zoneToken = loc.zoneCode.trim().toUpperCase();
            if (zoneToken === 'CLEAR') {
              row.zone_id = null;
            } else {
              const zoneId = zoneIdByWarehouseAndCode.get(resolvedWarehouseId)?.get(zoneToken);
              if (!zoneId) {
                failedCount += 1;
                errors.push(
                  `Row ${i + indexInBatch + 2}: Zone "${loc.zoneCode}" was not found for this warehouse.`
                );
                return;
              }
              row.zone_id = zoneId;
            }
          }

          insertData.push(row);
        });

        if (insertData.length === 0) {
          setProgress(Math.round(((i + batch.length) / parsedLocations.length) * 100));
          continue;
        }

        const { data, error } = await supabase
          .from('locations')
          .upsert(insertData, { onConflict: 'warehouse_id,code', ignoreDuplicates: false })
          .select();

        if (error) {
          failedCount += insertData.length;
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          successCount += data?.length || 0;
          failedCount += insertData.length - (data?.length || 0);
        }

        setProgress(Math.round(((i + batch.length) / parsedLocations.length) * 100));
      }

      setResult({ success: successCount, failed: failedCount, errors });
      setStep('complete');

      // Show accurate toast based on actual results
      if (successCount > 0 && failedCount === 0) {
        toast({
          title: 'Import Complete',
          description: `Successfully imported ${successCount} location${successCount !== 1 ? 's' : ''}.`,
        });
        onSuccess();
      } else if (successCount > 0 && failedCount > 0) {
        toast({
          variant: 'default',
          title: 'Import Partially Complete',
          description: `Imported ${successCount} location${successCount !== 1 ? 's' : ''}, ${failedCount} failed.`,
        });
        onSuccess();
      } else {
        toast({
          variant: 'destructive',
          title: 'Import Failed',
          description: `Failed to import locations. ${errors.length > 0 ? errors[0] : 'Please check the file format.'}`,
        });
      }
    } catch (error) {
      console.error('Import error:', error);
      setResult({ success: 0, failed: parsedLocations.length, errors: ['An unexpected error occurred'] });
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
    setParsedLocations([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Locations</DialogTitle>
          <DialogDescription>
            {step === 'preview' && 'Review the locations to be imported.'}
            {step === 'importing' && 'Importing locations...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        {step === 'preview' && (
          <div className="space-y-4">
            <div>
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

            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Locations found:</span>
                <span className="text-2xl font-bold">
                  {parsing ? <MaterialIcon name="progress_activity" size="lg" className="animate-spin" /> : parsedLocations.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                File: {file?.name}
              </p>
            </div>

            {parsedLocations.length > 0 && (
              <div className="max-h-[200px] overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Code</th>
                      <th className="text-left p-2">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedLocations.slice(0, 10).map((loc, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono">{loc.code}</td>
                        <td className="p-2">{loc.type}</td>
                      </tr>
                    ))}
                    {parsedLocations.length > 10 && (
                      <tr className="border-t">
                        <td colSpan={2} className="p-2 text-muted-foreground text-center">
                          ... and {parsedLocations.length - 10} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {step === 'importing' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
              <span>Importing locations...</span>
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
              <MaterialIcon name="check_circle" size="lg" />
              <span className="font-medium">{result.success} locations imported successfully</span>
            </div>
            {result.failed > 0 && (
              <div className="flex items-center gap-3 text-amber-600">
                <MaterialIcon name="warning" size="lg" />
                <span>{result.failed} locations failed to import</span>
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

        <DialogFooter>
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={parsedLocations.length === 0 || parsing}>
                Import {parsedLocations.length} Locations
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
