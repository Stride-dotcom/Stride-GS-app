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

interface AccountImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  onSuccess: () => void;
}

interface ParsedAccount {
  account_code: string;
  account_name: string;
  account_type?: string;
  status?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  billing_contact_name?: string;
  billing_contact_email?: string;
  billing_contact_phone?: string;
  billing_address?: string;
  billing_city?: string;
  billing_state?: string;
  billing_postal_code?: string;
  billing_country?: string;
  notes?: string;
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

// Header aliases for account imports
const ACCOUNT_HEADER_ALIASES: Record<string, string> = {
  account_code: 'account_code',
  code: 'account_code',
  account_number: 'account_code',
  
  account_name: 'account_name',
  name: 'account_name',
  company: 'account_name',
  company_name: 'account_name',
  
  account_type: 'account_type',
  type: 'account_type',
  
  status: 'status',
  
  primary_contact_name: 'primary_contact_name',
  contact_name: 'primary_contact_name',
  contact: 'primary_contact_name',
  
  primary_contact_email: 'primary_contact_email',
  email: 'primary_contact_email',
  contact_email: 'primary_contact_email',
  
  primary_contact_phone: 'primary_contact_phone',
  phone: 'primary_contact_phone',
  contact_phone: 'primary_contact_phone',
  
  billing_contact_name: 'billing_contact_name',
  billing_contact_email: 'billing_contact_email',
  billing_contact_phone: 'billing_contact_phone',
  
  billing_address: 'billing_address',
  address: 'billing_address',
  street: 'billing_address',
  street_address: 'billing_address',
  
  billing_city: 'billing_city',
  city: 'billing_city',
  
  billing_state: 'billing_state',
  state: 'billing_state',
  
  billing_postal_code: 'billing_postal_code',
  postal_code: 'billing_postal_code',
  zip: 'billing_postal_code',
  zip_code: 'billing_postal_code',
  
  billing_country: 'billing_country',
  country: 'billing_country',
  
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
};

const ALLOWED_KEYS = new Set([
  'account_code', 'account_name', 'account_type', 'status',
  'primary_contact_name', 'primary_contact_email', 'primary_contact_phone',
  'billing_contact_name', 'billing_contact_email', 'billing_contact_phone',
  'billing_address', 'billing_city', 'billing_state', 'billing_postal_code', 'billing_country',
  'notes',
]);

function parseRowToAccount(headers: string[], row: unknown[]): Record<string, unknown> | null {
  const obj: Record<string, unknown> = {};

  headers.forEach((headerRaw, idx) => {
    const header = canonicalizeHeader(headerRaw);
    const mapped = ACCOUNT_HEADER_ALIASES[header];
    if (!mapped || !ALLOWED_KEYS.has(mapped)) return;

    const cell = row[idx];
    const s = cell === null || cell === undefined ? '' : String(cell).trim();
    obj[mapped] = s === '' ? null : s;
  });

  // Require account_code and account_name
  if (!obj.account_code || !obj.account_name) return null;

  return obj;
}

async function parseFile(file: File): Promise<ParsedAccount[]> {
  const accounts: ParsedAccount[] = [];

  try {
    const { headers, rows } = await parseFileToRows(file);

    if (rows.length === 0) return accounts;

    for (const row of rows) {
      const parsed = parseRowToAccount(headers, row);
      if (parsed && parsed.account_code && parsed.account_name) {
        accounts.push({
          account_code: String(parsed.account_code),
          account_name: String(parsed.account_name),
          account_type: parsed.account_type ? String(parsed.account_type) : undefined,
          status: parsed.status ? String(parsed.status) : undefined,
          primary_contact_name: parsed.primary_contact_name ? String(parsed.primary_contact_name) : undefined,
          primary_contact_email: parsed.primary_contact_email ? String(parsed.primary_contact_email) : undefined,
          primary_contact_phone: parsed.primary_contact_phone ? String(parsed.primary_contact_phone) : undefined,
          billing_contact_name: parsed.billing_contact_name ? String(parsed.billing_contact_name) : undefined,
          billing_contact_email: parsed.billing_contact_email ? String(parsed.billing_contact_email) : undefined,
          billing_contact_phone: parsed.billing_contact_phone ? String(parsed.billing_contact_phone) : undefined,
          billing_address: parsed.billing_address ? String(parsed.billing_address) : undefined,
          billing_city: parsed.billing_city ? String(parsed.billing_city) : undefined,
          billing_state: parsed.billing_state ? String(parsed.billing_state) : undefined,
          billing_postal_code: parsed.billing_postal_code ? String(parsed.billing_postal_code) : undefined,
          billing_country: parsed.billing_country ? String(parsed.billing_country) : undefined,
          notes: parsed.notes ? String(parsed.notes) : undefined,
        });
      }
    }
  } catch (error) {
    console.error('Error parsing file:', error);
  }

  return accounts;
}

export function AccountImportDialog({
  open,
  onOpenChange,
  file,
  onSuccess,
}: AccountImportDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parsedAccounts, setParsedAccounts] = useState<ParsedAccount[]>([]);
  const [step, setStep] = useState<'preview' | 'importing' | 'complete'>('preview');
  const [parsing, setParsing] = useState(false);

  useEffect(() => {
    if (open && file && parsedAccounts.length === 0 && !parsing) {
      handleFileRead();
    }
  }, [open, file]);

  const handleFileRead = async () => {
    if (!file) return;

    setParsing(true);
    try {
      const accounts = await parseFile(file);
      setParsedAccounts(accounts);

      if (accounts.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Import Error',
          description: 'No valid accounts found. Ensure columns include Account Code and Account Name.',
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
    if (!profile?.tenant_id || parsedAccounts.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please ensure there are accounts to import.',
      });
      return;
    }

    setStep('importing');
    setImporting(true);
    setProgress(0);

    const batchSize = 25;
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    try {
      for (let i = 0; i < parsedAccounts.length; i += batchSize) {
        const batch = parsedAccounts.slice(i, i + batchSize);

        const insertData = batch.map((acc) => ({
          tenant_id: profile.tenant_id,
          account_code: acc.account_code,
          account_name: acc.account_name,
          account_type: acc.account_type || null,
          status: acc.status || 'active',
          primary_contact_name: acc.primary_contact_name || null,
          primary_contact_email: acc.primary_contact_email || null,
          primary_contact_phone: acc.primary_contact_phone || null,
          billing_contact_name: acc.billing_contact_name || null,
          billing_contact_email: acc.billing_contact_email || null,
          billing_contact_phone: acc.billing_contact_phone || null,
          billing_address: acc.billing_address || null,
          billing_city: acc.billing_city || null,
          billing_state: acc.billing_state || null,
          billing_postal_code: acc.billing_postal_code || null,
          billing_country: acc.billing_country || null,
          notes: acc.notes || null,
        }));

        const { data, error } = await supabase
          .from('accounts')
          .upsert(insertData, { onConflict: 'tenant_id,account_code', ignoreDuplicates: false })
          .select();

        if (error) {
          failedCount += batch.length;
          errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        } else {
          successCount += data?.length || 0;
          failedCount += batch.length - (data?.length || 0);
        }

        setProgress(Math.round(((i + batch.length) / parsedAccounts.length) * 100));
      }

      setResult({ success: successCount, failed: failedCount, errors });
      setStep('complete');

      if (successCount > 0 && failedCount === 0) {
        toast({
          title: 'Import Complete',
          description: `Successfully imported ${successCount} account${successCount !== 1 ? 's' : ''}.`,
        });
        onSuccess();
      } else if (successCount > 0 && failedCount > 0) {
        toast({
          variant: 'default',
          title: 'Import Partially Complete',
          description: `Imported ${successCount} account${successCount !== 1 ? 's' : ''}, ${failedCount} failed.`,
        });
        onSuccess();
      } else {
        toast({
          variant: 'destructive',
          title: 'Import Failed',
          description: `Failed to import accounts. ${errors.length > 0 ? errors[0] : 'Please check the file format.'}`,
        });
      }
    } catch (error) {
      console.error('Import error:', error);
      setResult({ success: 0, failed: parsedAccounts.length, errors: ['An unexpected error occurred'] });
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
    setParsedAccounts([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Accounts</DialogTitle>
          <DialogDescription>
            {step === 'preview' && 'Review the accounts to be imported.'}
            {step === 'importing' && 'Importing accounts...'}
            {step === 'complete' && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Accounts found:</span>
                <span className="text-2xl font-bold">
                  {parsing ? <MaterialIcon name="progress_activity" size="lg" className="animate-spin" /> : parsedAccounts.length}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                File: {file?.name}
              </p>
            </div>

            {parsedAccounts.length > 0 && (
              <div className="max-h-[200px] overflow-auto border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left p-2">Code</th>
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedAccounts.slice(0, 10).map((acc, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 font-mono">{acc.account_code}</td>
                        <td className="p-2">{acc.account_name}</td>
                        <td className="p-2 text-muted-foreground">{acc.primary_contact_name || '-'}</td>
                      </tr>
                    ))}
                    {parsedAccounts.length > 10 && (
                      <tr className="border-t">
                        <td colSpan={3} className="p-2 text-muted-foreground text-center">
                          ... and {parsedAccounts.length - 10} more
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
              <span>Importing accounts...</span>
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
              <span className="font-medium">{result.success} accounts imported successfully</span>
            </div>
            {result.failed > 0 && (
              <div className="flex items-center gap-3 text-amber-600">
                <MaterialIcon name="warning" size="lg" />
                <span>{result.failed} accounts failed to import</span>
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
              <Button onClick={handleImport} disabled={parsedAccounts.length === 0 || parsing}>
                Import {parsedAccounts.length} Accounts
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
