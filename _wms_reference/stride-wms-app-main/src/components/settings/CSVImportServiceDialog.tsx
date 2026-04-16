/**
 * CSVImportServiceDialog - Import service events from CSV files
 */

import { useState, useEffect, useRef } from 'react';
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
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  BILLING_TRIGGERS,
  BILLING_UNITS,
  CLASS_CODES,
} from '@/hooks/useServiceEventsAdmin';
import { parseFileToRows, canonicalizeHeader } from '@/lib/importUtils';

interface CSVImportServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ParsedService {
  class_code: string | null;
  service_code: string;
  service_name: string;
  billing_unit: string;
  service_time_minutes: number | null;
  rate: number;
  taxable: boolean;
  uses_class_pricing: boolean;
  is_active: boolean;
  notes: string | null;
  add_flag: boolean;
  add_to_service_event_scan: boolean;
  alert_rule: string;
  billing_trigger: string;
  valid: boolean;
  errors: string[];
}

interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// Header aliases for CSV import
const HEADER_ALIASES: Record<string, string> = {
  class_code: 'class_code',
  class: 'class_code',
  service_code: 'service_code',
  code: 'service_code',
  service_name: 'service_name',
  name: 'service_name',
  billing_unit: 'billing_unit',
  unit: 'billing_unit',
  service_time_minutes: 'service_time_minutes',
  time_minutes: 'service_time_minutes',
  minutes: 'service_time_minutes',
  rate: 'rate',
  price: 'rate',
  taxable: 'taxable',
  uses_class_pricing: 'uses_class_pricing',
  class_pricing: 'uses_class_pricing',
  is_active: 'is_active',
  active: 'is_active',
  notes: 'notes',
  add_flag: 'add_flag',
  flag: 'add_flag',
  add_to_service_event_scan: 'add_to_service_event_scan',
  scan_event: 'add_to_service_event_scan',
  alert_rule: 'alert_rule',
  alert: 'alert_rule',
  billing_trigger: 'billing_trigger',
  trigger: 'billing_trigger',
};

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.toLowerCase().trim();
  return v === 'true' || v === 'yes' || v === '1';
}

function validateService(service: ParsedService): ParsedService {
  const errors: string[] = [];

  if (!service.service_code) {
    errors.push('Missing service_code');
  }

  if (!service.service_name) {
    errors.push('Missing service_name');
  }

  if (!['Day', 'Item', 'Task'].includes(service.billing_unit)) {
    errors.push(`Invalid billing_unit: ${service.billing_unit}`);
  }

  if (service.rate < 0) {
    errors.push('Rate cannot be negative');
  }

  if (service.class_code && !CLASS_CODES.includes(service.class_code)) {
    errors.push(`Invalid class_code: ${service.class_code}`);
  }

  return {
    ...service,
    valid: errors.length === 0,
    errors,
  };
}

export function CSVImportServiceDialog({
  open,
  onOpenChange,
  onSuccess,
}: CSVImportServiceDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedServices, setParsedServices] = useState<ParsedService[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'complete'>('upload');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setFile(null);
      setParsedServices([]);
      setStep('upload');
      setProgress(0);
      setResult(null);
    }
  }, [open]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      parseFile(selectedFile);
    }
  };

  const parseFile = async (file: File) => {
    setParsing(true);
    try {
      const { headers, rows } = await parseFileToRows(file);

      if (rows.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Empty File',
          description: 'No data found in the file.',
        });
        setParsing(false);
        return;
      }

      // Map headers to field names
      const mappedHeaders = headers.map((h) => {
        const canonical = canonicalizeHeader(h);
        return HEADER_ALIASES[canonical] || null;
      });

      // Find column indices
      const indices: Record<string, number> = {};
      mappedHeaders.forEach((field, idx) => {
        if (field && indices[field] === undefined) {
          indices[field] = idx;
        }
      });

      // Parse rows
      const services: ParsedService[] = [];
      for (const row of rows) {
        const getValue = (field: string): string => {
          const idx = indices[field];
          return idx !== undefined ? String(row[idx] ?? '').trim() : '';
        };

        const service: ParsedService = {
          class_code: getValue('class_code').toUpperCase() || null,
          service_code: getValue('service_code').toUpperCase().replace(/\s+/g, '_'),
          service_name: getValue('service_name'),
          billing_unit: getValue('billing_unit') || 'Item',
          service_time_minutes: getValue('service_time_minutes')
            ? parseInt(getValue('service_time_minutes'))
            : null,
          rate: parseFloat(getValue('rate')) || 0,
          taxable: parseBoolean(getValue('taxable')),
          uses_class_pricing: parseBoolean(getValue('uses_class_pricing')),
          is_active: getValue('is_active') ? parseBoolean(getValue('is_active')) : true,
          notes: getValue('notes') || null,
          add_flag: parseBoolean(getValue('add_flag')),
          add_to_service_event_scan: parseBoolean(getValue('add_to_service_event_scan')),
          alert_rule: getValue('alert_rule') || 'none',
          billing_trigger: getValue('billing_trigger') || 'SCAN EVENT',
          valid: true,
          errors: [],
        };

        // Validate
        services.push(validateService(service));
      }

      setParsedServices(services);
      setStep('preview');
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        variant: 'destructive',
        title: 'Parse Error',
        description: 'Failed to parse the file. Please check the format.',
      });
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!profile?.tenant_id || parsedServices.length === 0) return;

    const validServices = parsedServices.filter((s) => s.valid);
    if (validServices.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No Valid Services',
        description: 'Please fix validation errors before importing.',
      });
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    const results: ImportResult = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    // Check existing service codes
    const { data: existingServices } = await (supabase
      .from('service_events') as any)
      .select('service_code')
      .eq('tenant_id', profile.tenant_id);

    const existingCodes = new Set(
      (existingServices || []).map((s: any) => s.service_code.toUpperCase())
    );

    // Group services by service_code for class-based pricing
    const serviceGroups = new Map<string, ParsedService[]>();
    for (const service of validServices) {
      const group = serviceGroups.get(service.service_code) || [];
      group.push(service);
      serviceGroups.set(service.service_code, group);
    }

    let processed = 0;
    const total = serviceGroups.size;

    for (const [serviceCode, services] of serviceGroups) {
      // Skip if service code already exists
      if (existingCodes.has(serviceCode)) {
        results.skipped += services.length;
        results.errors.push(`Skipped "${serviceCode}" - already exists`);
        processed++;
        setProgress(Math.round((processed / total) * 100));
        continue;
      }

      try {
        const inserts = services.map((s) => ({
          tenant_id: profile.tenant_id,
          class_code: s.class_code,
          service_code: s.service_code,
          service_name: s.service_name,
          billing_unit: s.billing_unit,
          service_time_minutes: s.service_time_minutes,
          rate: s.rate,
          taxable: s.taxable,
          uses_class_pricing: s.uses_class_pricing,
          is_active: s.is_active,
          notes: s.notes,
          add_flag: s.add_flag,
          add_to_service_event_scan: s.add_to_service_event_scan,
          alert_rule: s.alert_rule,
          billing_trigger: s.billing_trigger,
        }));

        const { error } = await (supabase
          .from('service_events') as any)
          .insert(inserts);

        if (error) {
          results.failed += services.length;
          results.errors.push(`Failed "${serviceCode}": ${error.message}`);
        } else {
          results.success += services.length;
        }
      } catch (error: any) {
        results.failed += services.length;
        results.errors.push(`Failed "${serviceCode}": ${error.message}`);
      }

      processed++;
      setProgress(Math.round((processed / total) * 100));
    }

    setResult(results);
    setStep('complete');
    setImporting(false);

    if (results.success > 0) {
      toast({
        title: 'Import Complete',
        description: `Successfully imported ${results.success} service${results.success !== 1 ? 's' : ''}.`,
      });
      onSuccess();
    }
  };

  const handleClose = () => {
    setFile(null);
    setParsedServices([]);
    setStep('upload');
    setProgress(0);
    setResult(null);
    onOpenChange(false);
  };

  const validCount = parsedServices.filter((s) => s.valid).length;
  const invalidCount = parsedServices.filter((s) => !s.valid).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Services from CSV</DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a CSV file to import service events.'}
            {step === 'preview' && 'Review the services to be imported.'}
            {step === 'importing' && 'Importing services...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        {/* Upload Step */}
        {step === 'upload' && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <MaterialIcon name="upload" size="lg" className="mx-auto text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-1">
                Click to upload or drag and drop
              </p>
              <p className="text-sm text-muted-foreground">
                CSV or Excel files supported
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {parsing && (
              <div className="flex items-center justify-center gap-2 py-4">
                <MaterialIcon name="progress_activity" size="md" className="animate-spin" />
                <span>Parsing file...</span>
              </div>
            )}
          </div>
        )}

        {/* Preview Step */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MaterialIcon name="description" size="md" className="text-muted-foreground" />
                <span className="font-medium">{file?.name}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                  setParsedServices([]);
                  setStep('upload');
                }}
              >
                <MaterialIcon name="close" size="sm" className="mr-1" />
                Change File
              </Button>
            </div>

            <div className="flex gap-4">
              <div className="bg-green-50 dark:bg-green-950 rounded-lg p-3 flex-1">
                <div className="text-2xl font-bold text-green-600">{validCount}</div>
                <div className="text-sm text-green-600">Valid services</div>
              </div>
              {invalidCount > 0 && (
                <div className="bg-red-50 dark:bg-red-950 rounded-lg p-3 flex-1">
                  <div className="text-2xl font-bold text-red-600">{invalidCount}</div>
                  <div className="text-sm text-red-600">Invalid (will skip)</div>
                </div>
              )}
            </div>

            <div className="max-h-[300px] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Service Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Trigger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedServices.slice(0, 50).map((service, idx) => (
                    <TableRow
                      key={idx}
                      className={!service.valid ? 'bg-red-50 dark:bg-red-950' : ''}
                    >
                      <TableCell>
                        {service.valid ? (
                          <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                        ) : (
                          <MaterialIcon name="warning" size="sm" className="text-red-600" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {service.service_code}
                      </TableCell>
                      <TableCell>{service.service_name}</TableCell>
                      <TableCell>
                        {service.class_code ? (
                          <Badge variant="outline">{service.class_code}</Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${service.rate.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {service.billing_trigger}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {parsedServices.length > 50 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        ... and {parsedServices.length - 50} more
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {invalidCount > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950 rounded-lg p-3">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {invalidCount} service{invalidCount !== 1 ? 's' : ''} will be skipped due to validation errors:
                </p>
                <ul className="text-xs text-amber-700 dark:text-amber-300 mt-1 list-disc list-inside">
                  {parsedServices
                    .filter((s) => !s.valid)
                    .slice(0, 5)
                    .map((s, idx) => (
                      <li key={idx}>
                        {s.service_code || '(no code)'}: {s.errors.join(', ')}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Importing Step */}
        {step === 'importing' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3">
              <MaterialIcon name="progress_activity" size="md" className="animate-spin text-primary" />
              <span>Importing services...</span>
            </div>
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground text-center">
              {progress}% complete
            </p>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && result && (
          <div className="space-y-4 py-4">
            {result.success > 0 && (
              <div className="flex items-center gap-3 text-green-600">
                <MaterialIcon name="check_circle" size="md" />
                <span className="font-medium">
                  {result.success} service{result.success !== 1 ? 's' : ''} imported successfully
                </span>
              </div>
            )}
            {result.skipped > 0 && (
              <div className="flex items-center gap-3 text-amber-600">
                <MaterialIcon name="warning" size="md" />
                <span>
                  {result.skipped} service{result.skipped !== 1 ? 's' : ''} skipped (already exist)
                </span>
              </div>
            )}
            {result.failed > 0 && (
              <div className="flex items-center gap-3 text-red-600">
                <MaterialIcon name="warning" size="md" />
                <span>
                  {result.failed} service{result.failed !== 1 ? 's' : ''} failed to import
                </span>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="bg-muted rounded-md p-3 max-h-[150px] overflow-auto">
                {result.errors.map((err, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    {err}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={validCount === 0}>
                Import {validCount} Service{validCount !== 1 ? 's' : ''}
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
