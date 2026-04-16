import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { parseFileToRows, canonicalizeHeader, parseBoolean, parseNumber } from '@/lib/importUtils';
import type { ChargeType } from '@/hooks/useChargeTypes';

// =============================================================================
// TYPES
// =============================================================================

interface ServiceRateImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  onSuccess: () => void;
  classCodes: string[];
}

interface ParsedRow {
  rowIndex: number;
  mapped: Record<string, unknown>;
  warnings: string[];
  errors: string[];
}

type ImportStep = 'preview' | 'importing' | 'done';

// =============================================================================
// FIELD DEFINITIONS — dynamically drives import mapping
// =============================================================================

const CHARGE_TYPE_FIELDS: { key: keyof ChargeType; type: 'string' | 'boolean' | 'number'; required?: boolean }[] = [
  { key: 'charge_code', type: 'string', required: true },
  { key: 'charge_name', type: 'string', required: true },
  { key: 'category', type: 'string' },
  { key: 'is_active', type: 'boolean' },
  { key: 'is_taxable', type: 'boolean' },
  { key: 'default_trigger', type: 'string' },
  { key: 'input_mode', type: 'string' },
  { key: 'add_to_scan', type: 'boolean' },
  { key: 'add_flag', type: 'boolean' },
  { key: 'flag_is_indicator', type: 'boolean' },
  { key: 'alert_rule', type: 'string' },
  { key: 'notes', type: 'string' },
];

const PRICING_FIELDS: { key: string; type: 'string' | 'number' }[] = [
  { key: 'pricing_method', type: 'string' },
  { key: 'unit', type: 'string' },
  { key: 'rate', type: 'number' },
  { key: 'minimum_charge', type: 'number' },
  { key: 'service_time_minutes', type: 'number' },
];

const VALID_TRIGGERS = ['manual', 'task', 'shipment', 'storage', 'auto'];
const VALID_INPUT_MODES = ['qty', 'time', 'both'];
const VALID_PRICING_METHODS = ['flat', 'class_based', 'tiered'];
const VALID_UNITS = ['each', 'per_item', 'per_task', 'per_hour', 'per_minute', 'per_day', 'per_month'];

// Header aliases for flexible matching
function buildAliasMap(classCodes: string[]): Record<string, string> {
  const aliases: Record<string, string> = {
    charge_code: 'charge_code',
    code: 'charge_code',
    service_code: 'charge_code',
    charge_name: 'charge_name',
    name: 'charge_name',
    service_name: 'charge_name',
    category: 'category',
    is_active: 'is_active',
    active: 'is_active',
    is_taxable: 'is_taxable',
    taxable: 'is_taxable',
    tax: 'is_taxable',
    default_trigger: 'default_trigger',
    trigger: 'default_trigger',
    auto_trigger: 'default_trigger',
    input_mode: 'input_mode',
    add_to_scan: 'add_to_scan',
    scan: 'add_to_scan',
    add_flag: 'add_flag',
    flag: 'add_flag',
    flag_is_indicator: 'flag_is_indicator',
    alert_rule: 'alert_rule',
    notes: 'notes',
    pricing_method: 'pricing_method',
    method: 'pricing_method',
    unit: 'unit',
    rate: 'rate',
    flat_rate: 'rate',
    minimum_charge: 'minimum_charge',
    min_charge: 'minimum_charge',
    service_time_minutes: 'service_time_minutes',
    service_time: 'service_time_minutes',
  };

  // Add dynamic class rate columns
  for (const code of classCodes) {
    const canonical = canonicalizeHeader(`Rate: ${code}`);
    aliases[canonical] = `class_rate_${code}`;
    aliases[canonicalizeHeader(code)] = `class_rate_${code}`;
    aliases[canonicalizeHeader(`rate_${code}`)] = `class_rate_${code}`;
  }

  return aliases;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function ServiceRateImportDialog({
  open,
  onOpenChange,
  file,
  onSuccess,
  classCodes,
}: ServiceRateImportDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<ImportStep>('preview');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [mappedHeaders, setMappedHeaders] = useState<(string | null)[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState({ created: 0, updated: 0, failed: 0, errors: [] as string[] });
  const [parsing, setParsing] = useState(false);

  const aliasMap = useMemo(() => buildAliasMap(classCodes), [classCodes]);

  // Parse file when dialog opens
  const parseFile = async () => {
    if (!file) return;
    setParsing(true);
    try {
      const { headers, rows } = await parseFileToRows(file);
      setRawHeaders(headers);

      // Map headers
      const mapped = headers.map((h) => {
        const canonical = canonicalizeHeader(h);
        return aliasMap[canonical] || null;
      });
      setMappedHeaders(mapped);

      // Parse rows
      const parsed: ParsedRow[] = rows.map((row, idx) => {
        const obj: Record<string, unknown> = {};
        const warnings: string[] = [];
        const errors: string[] = [];

        mapped.forEach((fieldName, colIdx) => {
          if (!fieldName) return;
          const rawVal = row[colIdx];
          if (rawVal === null || rawVal === undefined || String(rawVal).trim() === '') return;

          // Boolean fields
          const boolField = CHARGE_TYPE_FIELDS.find(f => f.key === fieldName && f.type === 'boolean');
          if (boolField) {
            const parsed = parseBoolean(rawVal);
            if (parsed === null) {
              warnings.push(`Invalid boolean for ${fieldName}: "${rawVal}"`);
            } else {
              obj[fieldName] = parsed;
            }
            return;
          }

          // Number fields
          const numField = PRICING_FIELDS.find(f => f.key === fieldName && f.type === 'number');
          if (numField || fieldName.startsWith('class_rate_')) {
            const parsed = parseNumber(rawVal);
            if (parsed === null) {
              warnings.push(`Invalid number for ${fieldName}: "${rawVal}"`);
            } else {
              obj[fieldName] = parsed;
            }
            return;
          }

          obj[fieldName] = String(rawVal).trim();
        });

        // Validate required
        if (!obj.charge_code) errors.push('Missing charge_code');
        if (!obj.charge_name) errors.push('Missing charge_name');

        // Validate enums
        if (obj.default_trigger && !VALID_TRIGGERS.includes(String(obj.default_trigger))) {
          warnings.push(`Invalid trigger: "${obj.default_trigger}"`);
        }
        if (obj.input_mode && !VALID_INPUT_MODES.includes(String(obj.input_mode))) {
          warnings.push(`Invalid input_mode: "${obj.input_mode}"`);
        }
        if (obj.pricing_method && !VALID_PRICING_METHODS.includes(String(obj.pricing_method))) {
          warnings.push(`Invalid pricing_method: "${obj.pricing_method}"`);
        }
        if (obj.unit && !VALID_UNITS.includes(String(obj.unit))) {
          warnings.push(`Invalid unit: "${obj.unit}"`);
        }

        return { rowIndex: idx + 2, mapped: obj, warnings, errors };
      });

      setParsedRows(parsed);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Parse error', description: err.message });
    } finally {
      setParsing(false);
    }
  };

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && file) {
      setStep('preview');
      setProgress(0);
      setResults({ created: 0, updated: 0, failed: 0, errors: [] });
      parseFile();
    }
    onOpenChange(isOpen);
  };

  const validRows = parsedRows.filter(r => r.errors.length === 0);
  const errorRows = parsedRows.filter(r => r.errors.length > 0);
  const mappedCount = mappedHeaders.filter(Boolean).length;

  // Import execution
  const handleImport = async () => {
    if (!profile?.tenant_id) return;
    setStep('importing');
    let created = 0, updated = 0, failed = 0;
    const importErrors: string[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const d = row.mapped;
      setProgress(Math.round(((i + 1) / validRows.length) * 100));

      try {
        // Build charge type payload
        const ctPayload: Record<string, unknown> = {
          tenant_id: profile.tenant_id,
          charge_code: d.charge_code,
          charge_name: d.charge_name,
        };

        // Map optional charge_type fields
        for (const field of CHARGE_TYPE_FIELDS) {
          if (field.key === 'charge_code' || field.key === 'charge_name') continue;
          if (d[field.key] !== undefined) {
            ctPayload[field.key] = d[field.key];
          }
        }

        // Check if exists
        const { data: existing } = await supabase
          .from('charge_types')
          .select('id')
          .eq('tenant_id', profile.tenant_id)
          .eq('charge_code', String(d.charge_code))
          .maybeSingle();

        let chargeTypeId: string;

        if (existing) {
          // Update
          const { error } = await (supabase as any)
            .from('charge_types')
            .update(ctPayload)
            .eq('id', existing.id);
          if (error) throw error;
          chargeTypeId = existing.id;
          updated++;
        } else {
          // Insert
          const { data: newCt, error } = await (supabase as any)
            .from('charge_types')
            .insert(ctPayload)
            .select('id')
            .single();
          if (error) throw error;
          chargeTypeId = newCt.id;
          created++;
        }

        // Handle pricing rules
        const hasClassRates = Object.keys(d).some(k => k.startsWith('class_rate_'));
        const pricingMethod = hasClassRates ? 'class_based' : (String(d.pricing_method || 'flat'));
        const unit = String(d.unit || 'each');
        const minCharge = d.minimum_charge as number | undefined;
        const serviceTime = d.service_time_minutes as number | undefined;

        // Delete existing pricing rules for this charge type
        await supabase
          .from('pricing_rules')
          .delete()
          .eq('charge_type_id', chargeTypeId);

        if (hasClassRates) {
          // Insert class-based rules
          const classRules = Object.entries(d)
            .filter(([k, v]) => k.startsWith('class_rate_') && v !== undefined)
            .map(([k, v]) => ({
              tenant_id: profile.tenant_id,
              charge_type_id: chargeTypeId,
              pricing_method: 'class_based' as const,
              class_code: k.replace('class_rate_', ''),
              unit,
              rate: Number(v),
              minimum_charge: minCharge ?? null,
              service_time_minutes: serviceTime ?? null,
              is_default: false,
            }));

          if (classRules.length > 0) {
            const { error } = await supabase
              .from('pricing_rules')
              .insert(classRules);
            if (error) throw error;
          }
        } else if (d.rate !== undefined) {
          // Insert flat rate
          const { error } = await supabase
            .from('pricing_rules')
            .insert({
              tenant_id: profile.tenant_id,
              charge_type_id: chargeTypeId,
              pricing_method: 'flat',
              class_code: null,
              unit,
              rate: Number(d.rate),
              minimum_charge: minCharge ?? null,
              service_time_minutes: serviceTime ?? null,
              is_default: true,
            });
          if (error) throw error;
        }
      } catch (err: any) {
        failed++;
        importErrors.push(`Row ${row.rowIndex}: ${err.message}`);
      }
    }

    setResults({ created, updated, failed, errors: importErrors });
    setStep('done');
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Service Rates</DialogTitle>
          <DialogDescription>
            {step === 'preview' && `Review ${parsedRows.length} rows from "${file?.name}"`}
            {step === 'importing' && 'Importing...'}
            {step === 'done' && 'Import complete'}
          </DialogDescription>
        </DialogHeader>

        {/* Preview step */}
        {step === 'preview' && !parsing && (
          <div className="flex-1 overflow-hidden space-y-3">
            {/* Header mapping summary */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{mappedCount} of {rawHeaders.length} columns mapped</Badge>
              <Badge variant="default">{validRows.length} valid rows</Badge>
              {errorRows.length > 0 && (
                <Badge variant="destructive">{errorRows.length} rows with errors</Badge>
              )}
            </div>

            {/* Unmapped columns warning */}
            {rawHeaders.some((_, i) => !mappedHeaders[i]) && (
              <div className="text-xs text-muted-foreground">
                Unmapped columns (will be skipped):{' '}
                {rawHeaders.filter((_, i) => !mappedHeaders[i]).join(', ')}
              </div>
            )}

            {/* Preview table */}
            <ScrollArea className="h-[350px] border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Row</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.slice(0, 50).map((row) => (
                    <TableRow key={row.rowIndex} className={row.errors.length > 0 ? 'bg-destructive/10' : ''}>
                      <TableCell className="text-xs text-muted-foreground">{row.rowIndex}</TableCell>
                      <TableCell className="font-mono text-xs">{String(row.mapped.charge_code || '')}</TableCell>
                      <TableCell className="text-sm">{String(row.mapped.charge_name || '')}</TableCell>
                      <TableCell className="text-xs">{String(row.mapped.category || '')}</TableCell>
                      <TableCell className="text-xs">{String(row.mapped.pricing_method || 'flat')}</TableCell>
                      <TableCell className="text-xs">
                        {row.mapped.rate !== undefined ? `$${Number(row.mapped.rate).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell>
                        {row.errors.length > 0 ? (
                          <Badge variant="destructive" className="text-[10px]">{row.errors[0]}</Badge>
                        ) : row.warnings.length > 0 ? (
                          <Badge variant="secondary" className="text-[10px]">{row.warnings.length} warning(s)</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            {parsedRows.length > 50 && (
              <p className="text-xs text-muted-foreground">Showing first 50 of {parsedRows.length} rows</p>
            )}
          </div>
        )}

        {parsing && (
          <div className="flex items-center justify-center py-12">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Parsing file...</span>
          </div>
        )}

        {/* Importing step */}
        {step === 'importing' && (
          <div className="py-8 space-y-4">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-center text-muted-foreground">
              Importing... {Math.round(progress)}%
            </p>
          </div>
        )}

        {/* Done step */}
        {step === 'done' && (
          <div className="py-6 space-y-4">
            <div className="flex gap-3 justify-center">
              {results.created > 0 && <Badge variant="default">{results.created} created</Badge>}
              {results.updated > 0 && <Badge variant="secondary">{results.updated} updated</Badge>}
              {results.failed > 0 && <Badge variant="destructive">{results.failed} failed</Badge>}
            </div>
            {results.errors.length > 0 && (
              <ScrollArea className="h-32 border rounded-md p-2">
                {results.errors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">{err}</p>
                ))}
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleImport} disabled={validRows.length === 0 || parsing}>
                <MaterialIcon name="upload" size="sm" className="mr-1.5" />
                Import {validRows.length} Rows
              </Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={() => { onOpenChange(false); onSuccess(); }}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
