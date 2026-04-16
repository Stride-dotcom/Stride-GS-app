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
import { useAuth } from '@/contexts/AuthContext';
import { parseFileToRows, canonicalizeHeader, parseBoolean, parseNumber } from '@/lib/importUtils';

interface EmployeeImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  onSuccess: () => void;
}

interface ParsedEmployee {
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  role?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  errors: string[];
}

// Header aliases for employee imports
const EMPLOYEE_HEADER_ALIASES: Record<string, string> = {
  email: 'email',
  email_address: 'email',
  
  first_name: 'first_name',
  firstname: 'first_name',
  first: 'first_name',
  given_name: 'first_name',
  
  last_name: 'last_name',
  lastname: 'last_name',
  last: 'last_name',
  surname: 'last_name',
  family_name: 'last_name',
  
  name: 'full_name', // Will be split
  full_name: 'full_name',
  
  phone: 'phone',
  phone_number: 'phone',
  mobile: 'phone',
  cell: 'phone',
  telephone: 'phone',
  
  role: 'role',
  roles: 'role',
  position: 'role',
  job_title: 'role',
};

const ALLOWED_KEYS = new Set(['email', 'first_name', 'last_name', 'full_name', 'phone', 'role']);

function parseRowToEmployee(headers: string[], row: unknown[]): Record<string, unknown> | null {
  const obj: Record<string, unknown> = {};

  headers.forEach((headerRaw, idx) => {
    const header = canonicalizeHeader(headerRaw);
    const mapped = EMPLOYEE_HEADER_ALIASES[header];
    if (!mapped || !ALLOWED_KEYS.has(mapped)) return;

    const cell = row[idx];
    const s = cell === null || cell === undefined ? '' : String(cell).trim();
    obj[mapped] = s === '' ? null : s;
  });

  // Handle full_name splitting
  if (obj.full_name && typeof obj.full_name === 'string') {
    const parts = obj.full_name.split(/\s+/);
    if (parts.length >= 2) {
      obj.first_name = obj.first_name || parts[0];
      obj.last_name = obj.last_name || parts.slice(1).join(' ');
    } else if (parts.length === 1) {
      obj.first_name = obj.first_name || parts[0];
    }
    delete obj.full_name;
  }

  // Require email
  if (!obj.email) return null;

  // Basic email validation
  const emailStr = String(obj.email);
  if (!emailStr.includes('@')) return null;

  return obj;
}

async function parseFile(file: File): Promise<ParsedEmployee[]> {
  const employees: ParsedEmployee[] = [];

  try {
    const { headers, rows } = await parseFileToRows(file);

    if (rows.length === 0) return employees;

    for (const row of rows) {
      const parsed = parseRowToEmployee(headers, row);
      if (parsed && parsed.email) {
        employees.push({
          email: String(parsed.email),
          first_name: parsed.first_name ? String(parsed.first_name) : undefined,
          last_name: parsed.last_name ? String(parsed.last_name) : undefined,
          phone: parsed.phone ? String(parsed.phone) : undefined,
          role: parsed.role ? String(parsed.role) : undefined,
        });
      }
    }
  } catch (error) {
    console.error('Error parsing file:', error);
  }

  return employees;
}

export function EmployeeImportDialog({
  open,
  onOpenChange,
  file,
  onSuccess,
}: EmployeeImportDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parsedEmployees, setParsedEmployees] = useState<ParsedEmployee[]>([]);
  const [step, setStep] = useState<'preview' | 'importing' | 'complete'>('preview');
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    if (open && file && parsedEmployees.length === 0 && !parsing) {
      handleFileRead();
    }
  }, [open, file]);

  const handleFileRead = async () => {
    if (!file) return;

    setParsing(true);
    try {
      const employees = await parseFile(file);
      setParsedEmployees(employees);

      if (employees.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Import Error',
          description: 'No valid employees found. Ensure an Email column is present.',
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
    if (!profile?.tenant_id || parsedEmployees.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please ensure there are employees to import.',
      });
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    try {
      // Process one at a time to handle existing employees
      for (let i = 0; i < parsedEmployees.length; i++) {
        const emp = parsedEmployees[i];

        // Check if user already exists
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('email', emp.email.toLowerCase())
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        if (existing) {
          // Update existing user
          const { error } = await supabase
            .from('users')
            .update({
              first_name: emp.first_name || null,
              last_name: emp.last_name || null,
              phone: emp.phone || null,
            })
            .eq('id', existing.id);

          if (error) {
            failedCount++;
            errors.push(`${emp.email}: ${error.message}`);
          } else {
            successCount++;
          }
        } else {
          // Create new user
          const { error } = await supabase
            .from('users')
            .insert({
              tenant_id: profile.tenant_id,
              email: emp.email.toLowerCase(),
              first_name: emp.first_name || null,
              last_name: emp.last_name || null,
              phone: emp.phone || null,
              password_hash: 'pending',
              status: 'pending',
            });

          if (error) {
            if (error.code === '23505') {
              // Duplicate - email exists in another tenant
              skippedCount++;
            } else {
              failedCount++;
              errors.push(`${emp.email}: ${error.message}`);
            }
          } else {
            successCount++;
          }
        }

        setProgress(Math.round(((i + 1) / parsedEmployees.length) * 100));
      }

      setResult({ success: successCount, failed: failedCount, skipped: skippedCount, errors });
      setStep('complete');

      if (successCount > 0 && failedCount === 0) {
        toast({
          title: 'Import Complete',
          description: `Successfully imported ${successCount} employee${successCount !== 1 ? 's' : ''}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ''}.`,
        });
        onSuccess();
      } else if (successCount > 0 && failedCount > 0) {
        toast({
          variant: 'default',
          title: 'Import Partially Complete',
          description: `Imported ${successCount} employee${successCount !== 1 ? 's' : ''}, ${failedCount} failed.`,
        });
        onSuccess();
      } else {
        toast({
          variant: 'destructive',
          title: 'Import Failed',
          description: `Failed to import employees. ${errors.length > 0 ? errors[0] : 'Please check the file format.'}`,
        });
      }
    } catch (error) {
      console.error('Import error:', error);
      setResult({ success: 0, failed: parsedEmployees.length, skipped: 0, errors: ['An unexpected error occurred'] });
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
    setParsedEmployees([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Employees</DialogTitle>
          <DialogDescription>
            {step === 'preview' && 'Review the employees to be imported.'}
            {step === 'importing' && 'Importing employees...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Employees found:</span>
                <span className="text-2xl font-bold">
                  {parsing ? <MaterialIcon name="progress_activity" size="lg" className="animate-spin" /> : parsedEmployees.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                File: {file?.name}
              </p>
            </div>

            {parsedEmployees.length > 0 && (
              <div className="max-h-[200px] overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Email</th>
                      <th className="text-left p-2">Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedEmployees.slice(0, 10).map((emp, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{emp.email}</td>
                        <td className="p-2">{[emp.first_name, emp.last_name].filter(Boolean).join(' ') || '-'}</td>
                      </tr>
                    ))}
                    {parsedEmployees.length > 10 && (
                      <tr className="border-t">
                        <td colSpan={2} className="p-2 text-muted-foreground text-center">
                          ... and {parsedEmployees.length - 10} more
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
              <span>Importing employees...</span>
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
              <span className="font-medium">{result.success} employees imported successfully</span>
            </div>
            {result.skipped > 0 && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <span>{result.skipped} already exist (skipped)</span>
              </div>
            )}
            {result.failed > 0 && (
              <div className="flex items-center gap-3 text-amber-600">
                <MaterialIcon name="warning" size="lg" />
                <span>{result.failed} employees failed to import</span>
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
              <Button onClick={handleImport} disabled={parsedEmployees.length === 0 || parsing}>
                Import {parsedEmployees.length} Employees
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
