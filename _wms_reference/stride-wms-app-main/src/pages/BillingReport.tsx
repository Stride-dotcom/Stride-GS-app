import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Search, FileText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { MultiSelect } from "@/components/ui/multi-select";

interface BillingEventRow {
  id: string;
  occurred_at: string;
  account_id: string;
  item_id: string | null;
  event_type: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  status: string;
  invoice_id: string | null;
  account_name?: string;
  item_code?: string;
}

interface Account {
  id: string;
  account_name: string;
  account_code: string;
}

function formatDateMMDDYY(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function toCSV(rows: BillingEventRow[]) {
  if (!rows.length) return "";
  const headers = ["occurred_at", "account_name", "item_code", "charge_type", "description", "quantity", "unit_rate", "total_amount", "status", "invoice_id"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      // Format occurred_at as mm/dd/yy
      if (h === 'occurred_at') {
        return escape(formatDateMMDDYY(r.occurred_at));
      }
      return escape(r[h as keyof BillingEventRow]);
    }).join(","));
  }
  return lines.join("\n");
}

export default function BillingReport() {
  const { toast } = useToast();
  const { profile } = useAuth();
  
  // Default to start of current month
  const [start, setStart] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [end, setEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string>("");
  const [rows, setRows] = useState<BillingEventRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);

  // Load accounts for dropdown
  useEffect(() => {
    async function loadAccounts() {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from("accounts")
        .select("id, account_name, account_code")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("account_name");
      setAccounts(data || []);
    }
    loadAccounts();
  }, [profile?.tenant_id]);

  const fetchRows = async () => {
    if (!profile?.tenant_id) return;
    
    setLoading(true);
    try {
      // Fetch billing events with account join only (item FK may not exist)
      let query = supabase
        .from("billing_events")
        .select(`
          id, occurred_at, account_id, item_id, event_type, charge_type,
          description, quantity, unit_rate, total_amount, status, invoice_id,
          accounts!billing_events_account_id_fkey(account_name)
        `)
        .eq("tenant_id", profile.tenant_id)
        .gte("occurred_at", `${start}T00:00:00.000Z`)
        .lte("occurred_at", `${end}T23:59:59.999Z`)
        .order("occurred_at", { ascending: false })
        .limit(1000);

      if (selectedAccounts.length > 0) {
        query = query.in("account_id", selectedAccounts);
      }
      if (selectedStatuses.length > 0) {
        query = query.in("status", selectedStatuses);
      }
      if (serviceFilter.trim()) {
        query = query.ilike("charge_type", `%${serviceFilter.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch item codes separately to avoid FK relationship issues
      const itemIds = [...new Set((data || []).map((r: any) => r.item_id).filter(Boolean))];
      let itemMap: Record<string, string> = {};
      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from("items")
          .select("id, item_code")
          .in("id", itemIds);
        if (items) {
          itemMap = Object.fromEntries(items.map((i: any) => [i.id, i.item_code]));
        }
      }

      // Transform data to flatten joins
      const transformed = (data || []).map((row: any) => ({
        ...row,
        account_name: row.accounts?.account_name || "-",
        item_code: row.item_id ? (itemMap[row.item_id] || "-") : "-",
      }));

      setRows(transformed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error(e);
      toast({ title: "Failed to load report", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `billing_report_${start}_to_${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchRows();
    }
  }, [profile?.tenant_id]);

  // Summary stats
  const stats = useMemo(() => {
    const unbilled = rows.filter(r => r.status === "unbilled").reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const invoiced = rows.filter(r => r.status === "invoiced").reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const voided = rows.filter(r => r.status === "void").reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return { unbilled, invoiced, voided, total: unbilled + invoiced };
  }, [rows]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "unbilled":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Unbilled</Badge>;
      case "invoiced":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Invoiced</Badge>;
      case "void":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Void</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Billing Report</h1>
            <p className="text-muted-foreground">View and export billing events</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={fetchRows} disabled={loading} variant="outline">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading..." : "Refresh"}
            </Button>
            <Button variant="outline" onClick={exportCSV} disabled={!rows.length}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Unbilled</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">${stats.unbilled.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Invoiced</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">${stats.invoiced.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Voided</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">${stats.voided.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Active</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${stats.total.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">End Date</label>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Account</label>
                <MultiSelect
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.account_code} - ${a.account_name}`,
                  }))}
                  selected={selectedAccounts}
                  onChange={setSelectedAccounts}
                  placeholder="All accounts"
                  emptyMessage="No accounts found"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Status</label>
                <MultiSelect
                  options={[
                    { value: 'unbilled', label: 'Unbilled' },
                    { value: 'invoiced', label: 'Invoiced' },
                    { value: 'void', label: 'Void' },
                  ]}
                  selected={selectedStatuses}
                  onChange={setSelectedStatuses}
                  placeholder="All statuses"
                  emptyMessage="No statuses found"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Service (contains)</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    value={serviceFilter} 
                    onChange={(e) => setServiceFilter(e.target.value)} 
                    placeholder="e.g. INSPECTION"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={fetchRows} disabled={loading}>
                <Search className="h-4 w-4 mr-2" />
                Run Report
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Billing Events ({rows.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-3 border-b font-medium">Date</th>
                    <th className="text-left p-3 border-b font-medium">Account</th>
                    <th className="text-left p-3 border-b font-medium">Item</th>
                    <th className="text-left p-3 border-b font-medium">Charge</th>
                    <th className="text-left p-3 border-b font-medium">Description</th>
                    <th className="text-right p-3 border-b font-medium">Qty</th>
                    <th className="text-right p-3 border-b font-medium">Rate</th>
                    <th className="text-right p-3 border-b font-medium">Total</th>
                    <th className="text-center p-3 border-b font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b hover:bg-muted/50">
                      <td className="p-3">{r.occurred_at?.slice(0, 10)}</td>
                      <td className="p-3">{r.account_name}</td>
                      <td className="p-3 font-mono text-xs">{r.item_code}</td>
                      <td className="p-3">{r.charge_type}</td>
                      <td className="p-3 max-w-[200px] truncate">{r.description || "-"}</td>
                      <td className="p-3 text-right">{r.quantity}</td>
                      <td className="p-3 text-right">${Number(r.unit_rate || 0).toFixed(2)}</td>
                      <td className="p-3 text-right font-semibold">${Number(r.total_amount || 0).toFixed(2)}</td>
                      <td className="p-3 text-center">{getStatusBadge(r.status)}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td className="p-8 text-center text-muted-foreground" colSpan={9}>
                        No billing events found for the selected filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
