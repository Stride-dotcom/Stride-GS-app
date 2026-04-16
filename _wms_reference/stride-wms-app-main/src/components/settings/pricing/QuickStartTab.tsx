import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useTenantTemplates, type TemplateResult } from '@/hooks/useTenantTemplates';
import { useChargeTypesWithRules } from '@/hooks/useChargeTypes';
import { useClasses } from '@/hooks/useClasses';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { getClassCubicFeetExportValue } from '@/lib/pricing/classCubicFeet';
import ExcelJS from 'exceljs';
import { readWorkbook, sheetToJson, addAoaSheet, downloadWorkbook } from '@/lib/excelUtils';

export function QuickStartTab() {
  const { loading, applyCoreDefaults, applyFullStarter } = useTenantTemplates();
  const { chargeTypesWithRules, refetch: refetchChargeTypes } = useChargeTypesWithRules();
  const { classes } = useClasses();
  const { profile } = useAuth();
  const { toast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<'core' | 'full' | null>(null);
  const [resultData, setResultData] = useState<TemplateResult | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleApplyCoreDefaults = async () => {
    setConfirmDialog(null);
    const result = await applyCoreDefaults();
    if (result) {
      setResultData(result);
      refetchChargeTypes();
    }
  };

  const handleApplyFullStarter = async () => {
    setConfirmDialog(null);
    const result = await applyFullStarter();
    if (result) {
      setResultData(result);
      refetchChargeTypes();
    }
  };

  // =========================================================================
  // EXPORT
  // =========================================================================

  const handleExportTemplate = async () => {
    const wb = new ExcelJS.Workbook();

    // Instructions sheet
    const instructions = [
      ['Service Rates Import / Export Template'],
      [''],
      ['Instructions:'],
      ['1. Fill in the "Charge Types" sheet with your service configurations'],
      ['2. For class-based pricing, add rates in the "Pricing Rules" sheet'],
      ['3. Save the file and upload it using the "Upload & Preview" button'],
      [''],
      ['Column Descriptions (Charge Types sheet):'],
      ['charge_code - Unique code for the service (e.g., INSP, RECV)'],
      ['charge_name - Display name (e.g., Standard Inspection)'],
      ['category - Category (e.g., receiving, storage, handling, task, shipping, service)'],
      ['default_trigger - manual, task, shipment, storage, or auto'],
      ['input_mode - qty, time, or both'],
      ['is_active - TRUE or FALSE'],
      ['is_taxable - TRUE or FALSE'],
      ['add_to_scan - TRUE or FALSE'],
      ['add_flag - TRUE or FALSE'],
      ['flag_is_indicator - TRUE or FALSE (indicator-only flag, no billing)'],
      ['notes - Optional notes'],
      [''],
      ['Column Descriptions (Pricing Rules sheet):'],
      ['charge_code - Must match a code from the Charge Types sheet'],
      ['pricing_method - flat or class_based'],
      ['class_code - Leave empty for flat, set XS/S/M/L/XL/XXL for class_based'],
      ['unit - each, per_item, per_task, per_hour, per_minute, per_day, per_month'],
      ['rate - Dollar amount (e.g., 15.00)'],
      ['minimum_charge - Optional minimum charge amount'],
      ['service_time_minutes - Optional estimated time in minutes'],
    ];
    addAoaSheet(wb, instructions, 'Instructions');

    // Charge Types sheet
    const ctHeaders = [
      'charge_code', 'charge_name', 'category', 'default_trigger', 'input_mode',
      'is_active', 'is_taxable', 'add_to_scan', 'add_flag', 'flag_is_indicator', 'notes',
    ];
    const ctData = chargeTypesWithRules.map(ct => [
      ct.charge_code,
      ct.charge_name,
      ct.category,
      ct.default_trigger,
      ct.input_mode || 'qty',
      ct.is_active,
      ct.is_taxable,
      ct.add_to_scan,
      ct.add_flag,
      ct.flag_is_indicator,
      ct.notes || '',
    ]);
    addAoaSheet(wb, [ctHeaders, ...ctData], 'Charge Types');

    // Pricing Rules sheet
    const prHeaders = ['charge_code', 'pricing_method', 'class_code', 'unit', 'rate', 'minimum_charge', 'service_time_minutes'];
    const prData: (string | number | boolean)[][] = [];
    chargeTypesWithRules.forEach(ct => {
      if (ct.pricing_rules.length === 0) {
        prData.push([ct.charge_code, 'flat', '', 'each', 0, '', '']);
      } else {
        ct.pricing_rules.forEach(r => {
          prData.push([
            ct.charge_code,
            r.pricing_method || 'flat',
            r.class_code || '',
            r.unit || 'each',
            r.rate,
            r.minimum_charge ?? '',
            r.service_time_minutes ?? '',
          ]);
        });
      }
    });
    addAoaSheet(wb, [prHeaders, ...prData], 'Pricing Rules');

    // Classes Reference sheet
    const classRefHeaders = ['code', 'name', 'cubic_feet', 'sort_order'];
    const classRefData = classes.map(c => [
      c.code,
      c.name,
      getClassCubicFeetExportValue(c),
      c.sort_order || '',
    ]);
    addAoaSheet(wb, [classRefHeaders, ...classRefData], 'Classes Reference');

    await downloadWorkbook(wb, 'service-rates-export.xlsx');
    toast({ title: 'Export downloaded', description: 'Your service rates have been exported.' });
  };

  // =========================================================================
  // IMPORT - File parse & preview
  // =========================================================================

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = await readWorkbook(buffer);

      // Support both old and new sheet names
      const ctSheet = wb.getWorksheet('Charge Types') || wb.getWorksheet('Services');
      const prSheet = wb.getWorksheet('Pricing Rules') || wb.getWorksheet('Class Rates');

      if (!ctSheet) {
        toast({ variant: 'destructive', title: 'Invalid file', description: 'Missing "Charge Types" or "Services" sheet' });
        return;
      }

      const chargeTypeRows = sheetToJson<Record<string, string | number | boolean>>(ctSheet);
      const pricingRuleRows: Record<string, string | number>[] = prSheet ? sheetToJson(prSheet) : [];

      const existingCodes = new Set(chargeTypesWithRules.map(ct => ct.charge_code));
      const preview: ImportPreviewRow[] = chargeTypeRows.map(row => {
        const code = String(row.charge_code || '').trim();
        const name = String(row.charge_name || '').trim();
        const hasError = !code || !name;
        const status: ImportStatus = hasError ? 'error' : existingCodes.has(code) ? 'update' : 'new';
        return {
          ...row,
          charge_code: code,
          charge_name: name,
          status,
          error: hasError ? (!code ? 'Missing charge_code' : 'Missing charge_name') : undefined,
          pricingRules: pricingRuleRows.filter(pr => String(pr.charge_code).trim() === code),
        };
      });

      setImportPreview({
        rows: preview,
        newCount: preview.filter(r => r.status === 'new').length,
        updateCount: preview.filter(r => r.status === 'update').length,
        errorCount: preview.filter(r => r.status === 'error').length,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Error reading file', description: 'Please ensure the file is a valid .xlsx file.' });
    }

    // Reset input so same file can be re-uploaded
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // =========================================================================
  // IMPORT - Apply
  // =========================================================================

  const handleImportApply = async () => {
    if (!importPreview || !profile?.tenant_id) return;

    setImporting(true);
    let created = 0;
    let updated = 0;
    let errors = 0;

    try {
      const validRows = importPreview.rows.filter(r => r.status !== 'error');

      for (const row of validRows) {
        try {
          const chargeTypeData = {
            tenant_id: profile.tenant_id,
            charge_code: row.charge_code,
            charge_name: String(row.charge_name || ''),
            category: String(row.category || 'service').toLowerCase(),
            default_trigger: String(row.default_trigger || 'manual'),
            input_mode: String(row.input_mode || 'qty'),
            is_active: parseBool(row.is_active, true),
            is_taxable: parseBool(row.is_taxable, false),
            add_to_scan: parseBool(row.add_to_scan, false),
            add_flag: parseBool(row.add_flag, false),
            flag_is_indicator: parseBool(row.flag_is_indicator, false),
            notes: row.notes ? String(row.notes) : null,
          };

          let chargeTypeId: string;

          if (row.status === 'new') {
            // Insert new charge type
            const { data, error } = await supabase
              .from('charge_types')
              .insert(chargeTypeData)
              .select('id')
              .single();

            if (error) throw error;
            chargeTypeId = data.id;
            created++;
          } else {
            // Update existing charge type
            const existing = chargeTypesWithRules.find(ct => ct.charge_code === row.charge_code);
            if (!existing) continue;
            chargeTypeId = existing.id;

            const { charge_code: _code, tenant_id: _tid, ...updateData } = chargeTypeData;
            const { error } = await supabase
              .from('charge_types')
              .update(updateData)
              .eq('id', chargeTypeId);

            if (error) throw error;
            updated++;
          }

          // Upsert pricing rules for this charge type
          if (row.pricingRules.length > 0) {
            // Delete existing pricing rules for this charge type (replace strategy)
            await supabase
              .from('pricing_rules')
              .delete()
              .eq('charge_type_id', chargeTypeId);

            // Insert new pricing rules
            const rulesToInsert = row.pricingRules.map(pr => ({
              tenant_id: profile.tenant_id,
              charge_type_id: chargeTypeId,
              pricing_method: String(pr.pricing_method || 'flat'),
              class_code: pr.class_code ? String(pr.class_code).trim() : null,
              unit: String(pr.unit || 'each'),
              rate: parseFloat(String(pr.rate || '0')),
              minimum_charge: pr.minimum_charge ? parseFloat(String(pr.minimum_charge)) : null,
              service_time_minutes: pr.service_time_minutes ? parseInt(String(pr.service_time_minutes), 10) : null,
              is_default: !pr.class_code,
            }));

            const { error: prError } = await supabase
              .from('pricing_rules')
              .insert(rulesToInsert);

            if (prError) throw prError;
          }
        } catch (rowError) {
          console.error(`Import error for ${row.charge_code}:`, rowError);
          errors++;
        }
      }

      toast({
        title: 'Import Complete',
        description: `Created ${created}, updated ${updated}${errors > 0 ? `, ${errors} errors` : ''}`,
      });

      setImportPreview(null);
      refetchChargeTypes();
    } catch (error) {
      console.error('Import failed:', error);
      toast({
        variant: 'destructive',
        title: 'Import Failed',
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Safe to run banner */}
      <Card className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <MaterialIcon name="info" className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <div className="text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium">Safe to Run Multiple Times</p>
              <p className="mt-1">
                Templates only ADD missing records. They never overwrite or delete existing data.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Template Packs */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Core Defaults */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="category" className="text-primary" />
                  Core Defaults
                </CardTitle>
                <CardDescription className="mt-1">Categories, task types, and flat charge types to get started</CardDescription>
              </div>
              <Badge variant="secondary">Recommended</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>8 service categories</span>
              </div>
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>6 system task types</span>
              </div>
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>18 starter charge types (flat, no classes)</span>
              </div>
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>Quarantine indicator flag included</span>
              </div>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">All rates are $0 — set your own prices after applying.</p>
            <Button
              onClick={() => setConfirmDialog('core')}
              disabled={loading}
              className="w-full"
              variant="outline"
            >
              {loading ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
                  Apply Core Defaults
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Full Starter */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="rocket_launch" className="text-primary" />
                  Full Starter Pack
                </CardTitle>
                <CardDescription className="mt-1">Everything in Core + size classes + class-based pricing structure</CardDescription>
              </div>
              <Badge>Complete</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>Everything in Core Defaults</span>
              </div>
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>3 service tiers (Standard, Premium, Deluxe)</span>
              </div>
              <div className="flex items-center gap-2">
                <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                <span>Class-based pricing rules for key services</span>
              </div>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">All rates are $0 — set your own prices after applying.</p>
            <Button
              onClick={() => setConfirmDialog('full')}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <MaterialIcon name="rocket_launch" size="sm" className="mr-2" />
                  Apply Full Starter
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Result Summary */}
      {resultData && (
        <Card className="bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <MaterialIcon name="check_circle" className="text-green-600" />
              <span className="font-medium text-green-800 dark:text-green-200">Applied Successfully</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Categories</span>
                <p className="font-medium">
                  {resultData.categories_added > 0 ? (
                    <span className="text-green-600">+{resultData.categories_added}</span>
                  ) : '-'}
                  <span className="text-muted-foreground"> / {resultData.total_categories}</span>
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Task Types</span>
                <p className="font-medium">
                  {resultData.task_types_added > 0 ? (
                    <span className="text-green-600">+{resultData.task_types_added}</span>
                  ) : '-'}
                  <span className="text-muted-foreground"> / {resultData.total_task_types}</span>
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Classes</span>
                <p className="font-medium">
                  {resultData.classes_added > 0 ? (
                    <span className="text-green-600">+{resultData.classes_added}</span>
                  ) : '-'}
                  <span className="text-muted-foreground"> / {resultData.total_classes}</span>
                </p>
              </div>
              {resultData.services_added !== undefined && (
                <div>
                  <span className="text-muted-foreground">Charge Types</span>
                  <p className="font-medium">
                    {resultData.services_added > 0 ? (
                      <span className="text-green-600">+{resultData.services_added}</span>
                    ) : '-'}
                    <span className="text-muted-foreground"> / {resultData.total_services}</span>
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Excel Import/Export */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="table_chart" size="md" />
            Excel Import / Export
          </CardTitle>
          <CardDescription>
            Export your current service rates or import from a spreadsheet. Upload previews changes before applying.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" onClick={handleExportTemplate}>
              <MaterialIcon name="download" size="sm" className="mr-1.5" />
              Export Rates
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <MaterialIcon name="upload" size="sm" className="mr-1.5" />
              Upload & Preview
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Existing charge types matched by code will be updated. New codes will be created. Pricing rules are replaced on import.
          </p>
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <AlertDialog open={confirmDialog !== null} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Apply {confirmDialog === 'core' ? 'Core Defaults' : 'Full Starter'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog === 'core'
                ? 'This will add any missing service categories, task types, and size classes. Existing records will not be modified.'
                : 'This will add core defaults plus the starter price list with default rates. Existing records will not be modified.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDialog === 'core' ? handleApplyCoreDefaults : handleApplyFullStarter}
            >
              Apply
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Preview Dialog */}
      <Dialog open={!!importPreview} onOpenChange={() => setImportPreview(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
            <DialogDescription>
              Review the changes before importing. Existing charge types will be updated; new ones will be created.
            </DialogDescription>
          </DialogHeader>
          {importPreview && (
            <div className="space-y-4">
              <div className="flex gap-3 text-sm">
                <Badge className="bg-green-600">{importPreview.newCount} New</Badge>
                <Badge className="bg-amber-500">{importPreview.updateCount} Update</Badge>
                {importPreview.errorCount > 0 && (
                  <Badge variant="destructive">{importPreview.errorCount} Errors</Badge>
                )}
              </div>
              <div className="border rounded-lg overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Status</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead className="text-right">Rules</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.rows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Badge
                            variant={row.status === 'new' ? 'default' : row.status === 'error' ? 'destructive' : 'secondary'}
                            className={row.status === 'new' ? 'bg-green-600' : row.status === 'update' ? 'bg-amber-500' : ''}
                          >
                            {row.status.toUpperCase()}
                          </Badge>
                          {row.error && <p className="text-xs text-destructive mt-1">{row.error}</p>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.charge_code}</TableCell>
                        <TableCell>{String(row.charge_name || '')}</TableCell>
                        <TableCell>{String(row.category || '')}</TableCell>
                        <TableCell>{String(row.default_trigger || 'manual')}</TableCell>
                        <TableCell className="text-right">{row.pricingRules.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button
              onClick={handleImportApply}
              disabled={importing || (importPreview?.errorCount ?? 0) === importPreview?.rows.length}
            >
              {importing ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />
                  Importing...
                </>
              ) : (
                `Import ${(importPreview?.newCount ?? 0) + (importPreview?.updateCount ?? 0)} Charge Types`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

// =============================================================================
// TYPES
// =============================================================================

type ImportStatus = 'new' | 'update' | 'skip' | 'error';

interface ImportPreviewRow extends Record<string, unknown> {
  charge_code: string;
  charge_name: string;
  status: ImportStatus;
  error?: string;
  pricingRules: Record<string, string | number>[];
}

interface ImportPreviewData {
  rows: ImportPreviewRow[];
  newCount: number;
  updateCount: number;
  errorCount: number;
}
