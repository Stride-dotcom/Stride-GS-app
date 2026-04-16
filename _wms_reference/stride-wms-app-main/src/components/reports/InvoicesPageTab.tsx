import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInvoices, Invoice, InvoiceLine, InvoiceType } from "@/hooks/useInvoices";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAuth } from "@/contexts/AuthContext";

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  billing_contact_email: string | null;
}

type SortField = 'invoice_number' | 'created_at' | 'total' | 'status';
type SortDir = 'asc' | 'desc';

export function InvoicesPageTab() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { createInvoiceDraft, markInvoiceSent, voidInvoice, fetchInvoices, fetchInvoiceLines } = useInvoices();

  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [periodStart, setPeriodStart] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("weekly_services");
  const [includeEarlier, setIncludeEarlier] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Lines dialog
  const [linesDialogOpen, setLinesDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  // Load accounts
  useEffect(() => {
    async function loadAccounts() {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from("accounts")
        .select("id, account_name, account_code, billing_contact_email")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("account_name");
      setAccounts(data || []);
    }
    loadAccounts();
  }, [profile?.tenant_id]);

  const load = async () => {
    setLoading(true);
    const data = await fetchInvoices({ limit: 100 });
    setInvoices(data);
    setLoading(false);
  };

  useEffect(() => {
    if (profile?.tenant_id) {
      load();
    }
  }, [profile?.tenant_id]);

  // Sorted invoices
  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'invoice_number':
          aVal = a.invoice_number || '';
          bVal = b.invoice_number || '';
          break;
        case 'total':
          aVal = Number(a.total) || 0;
          bVal = Number(b.total) || 0;
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'created_at':
        default:
          aVal = a.created_at || '';
          bVal = b.created_at || '';
          break;
      }
      if (sortDir === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
  }, [invoices, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <MaterialIcon name="swap_vert" style={{ fontSize: '12px' }} className="ml-1 opacity-50" />;
    return sortDir === 'asc' ? <MaterialIcon name="expand_less" style={{ fontSize: '12px' }} className="ml-1" /> : <MaterialIcon name="expand_more" style={{ fontSize: '12px' }} className="ml-1" />;
  };

  const createDraft = async () => {
    if (!accountId) {
      toast({ title: "Account required", description: "Please select an account.", variant: "destructive" });
      return;
    }
    setCreating(true);
    const inv = await createInvoiceDraft({
      accountId,
      invoiceType,
      periodStart,
      periodEnd,
      sidemark: null,
      includeUnbilledBeforePeriod: includeEarlier,
    });
    if (inv) await load();
    setCreating(false);
  };

  const openLines = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setLinesDialogOpen(true);
    setLoadingLines(true);
    const data = await fetchInvoiceLines(invoice.id);
    setLines(data);
    setLoadingLines(false);
  };

  const handleMarkSent = async (invoiceId: string) => {
    await markInvoiceSent(invoiceId);
    await load();
  };

  const handleVoid = async (invoiceId: string) => {
    await voidInvoice(invoiceId);
    await load();
    setLinesDialogOpen(false);
  };

  const getStatusBadge = (status: string): React.ReactNode => (
    <StatusIndicator status={status} size="sm" />
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Invoices</h2>
          <p className="text-muted-foreground text-sm">Create and manage invoices</p>
        </div>
        <Button onClick={load} disabled={loading} variant="outline" size="sm">
          <MaterialIcon name="refresh" size="sm" className={`mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Create Invoice Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create Invoice</CardTitle>
          <CardDescription>Generate a new invoice for an account</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Account</label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.account_code} - {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Type</label>
              <Select value={invoiceType} onValueChange={(v) => setInvoiceType(v as InvoiceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly_services">Weekly Services</SelectItem>
                  <SelectItem value="monthly_storage">Monthly Storage</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Period Start</label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Period End</label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={createDraft} disabled={creating || !accountId} className="w-full">
                {creating ? <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" /> : <MaterialIcon name="add" size="sm" className="mr-2" />}
                Create Draft
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Checkbox
              id="includeEarlier"
              checked={includeEarlier}
              onCheckedChange={(c) => setIncludeEarlier(!!c)}
            />
            <label htmlFor="includeEarlier" className="text-sm text-muted-foreground">
              Include unbilled charges from before period start
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="description" size="md" />
            Invoices ({invoices.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('invoice_number')}>
                  <span className="flex items-center">Invoice # <SortIcon field="invoice_number" /></span>
                </TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('created_at')}>
                  <span className="flex items-center">Created <SortIcon field="created_at" /></span>
                </TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('total')}>
                  <span className="flex items-center justify-end">Total <SortIcon field="total" /></span>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('status')}>
                  <span className="flex items-center">Status <SortIcon field="status" /></span>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedInvoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono">{inv.invoice_number || "-"}</TableCell>
                  <TableCell>{String(inv.account_name || "-")}</TableCell>
                  <TableCell>{inv.created_at?.slice(0, 10) || "-"}</TableCell>
                  <TableCell className="text-xs">
                    {inv.period_start?.slice(0, 10)} - {inv.period_end?.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">${Number(inv.total || 0).toFixed(2)}</TableCell>
                  <TableCell>{getStatusBadge(inv.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openLines(inv)} title="View details">
                        <MaterialIcon name="visibility" size="sm" />
                      </Button>
                      {inv.status === "draft" && (
                        <Button variant="ghost" size="icon" onClick={() => handleMarkSent(inv.id)} title="Mark as sent">
                          <MaterialIcon name="send" size="sm" className="text-blue-600" />
                        </Button>
                      )}
                      {inv.status !== "void" && (
                        <Button variant="ghost" size="icon" onClick={() => handleVoid(inv.id)} title="Void invoice">
                          <MaterialIcon name="cancel" size="sm" className="text-red-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!invoices.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No invoices found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invoice Lines Dialog */}
      <Dialog open={linesDialogOpen} onOpenChange={setLinesDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice {selectedInvoice?.invoice_number}</DialogTitle>
            <DialogDescription>
              {String(selectedInvoice?.account_name || '')} • {selectedInvoice?.status && getStatusBadge(selectedInvoice.status)}
            </DialogDescription>
          </DialogHeader>

          {loadingLines ? (
            <div className="flex items-center justify-center py-8">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="text-right">{line.quantity}</TableCell>
                    <TableCell className="text-right">${Number(line.unit_rate || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-right font-semibold">${Number(line.amount || 0).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {!lines.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                      No line items
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <DialogFooter className="mt-4">
            <div className="flex justify-between w-full items-center">
              <span className="text-lg font-bold">
                Total: ${Number(selectedInvoice?.total || 0).toFixed(2)}
              </span>
              <Button variant="outline" onClick={() => setLinesDialogOpen(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
