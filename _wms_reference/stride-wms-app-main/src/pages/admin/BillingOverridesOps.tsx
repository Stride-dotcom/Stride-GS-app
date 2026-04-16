import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useToast } from "@/hooks/use-toast";
import {
  BillingOverrideFilter,
  BillingOverrideLogEntry,
  TenantBillingOverrideProfile,
  useBillingOverridesAdmin,
} from "@/hooks/useBillingOverridesAdmin";
import { BackToDevConsoleButton } from "@/components/admin/BackToDevConsoleButton";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return format(parsed, "PPP p");
}

function toLocalDateTimeInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "comped" || status === "active") return "default";
  if (status === "past_due" || status === "canceled" || status === "inactive") return "destructive";
  if (status === "none") return "outline";
  return "secondary";
}

export default function BillingOverridesOps() {
  const { toast } = useToast();
  const { profiles, loading, updating, refetch, setBillingOverride, fetchTenantLog } =
    useBillingOverridesAdmin();

  const [filter, setFilter] = useState<BillingOverrideFilter>("all");
  const [editingProfile, setEditingProfile] = useState<TenantBillingOverrideProfile | null>(null);
  const [historyProfile, setHistoryProfile] = useState<TenantBillingOverrideProfile | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<BillingOverrideLogEntry[]>([]);
  const [isComped, setIsComped] = useState(true);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.is_comped !== b.is_comped) return a.is_comped ? -1 : 1;
      const aTime = a.override_updated_at ? new Date(a.override_updated_at).getTime() : 0;
      const bTime = b.override_updated_at ? new Date(b.override_updated_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [profiles]);

  const openUpdateDialog = (profile: TenantBillingOverrideProfile, nextCompedState: boolean) => {
    setEditingProfile(profile);
    setIsComped(nextCompedState);
    setReason(nextCompedState ? profile.comped_reason || "" : "");
    setNote("");
    setExpiresAtLocal(nextCompedState ? toLocalDateTimeInputValue(profile.expires_at) : "");
  };

  const closeUpdateDialog = () => {
    setEditingProfile(null);
    setReason("");
    setNote("");
    setExpiresAtLocal("");
  };

  const handleApplyOverride = async () => {
    if (!editingProfile) return;
    if (isComped && !reason.trim()) {
      toast({
        variant: "destructive",
        title: "Comped reason required",
        description: "Provide a short reason when enabling a comped override.",
      });
      return;
    }

    let expiresAtIso: string | null = null;
    if (isComped && expiresAtLocal.trim()) {
      const parsed = new Date(expiresAtLocal);
      if (Number.isNaN(parsed.getTime())) {
        toast({
          variant: "destructive",
          title: "Invalid expiration date",
          description: "Use a valid date/time or clear the field for no expiration.",
        });
        return;
      }
      expiresAtIso = parsed.toISOString();
    }

    try {
      await setBillingOverride({
        tenantId: editingProfile.tenant_id,
        isComped,
        reason: isComped ? reason.trim() : null,
        note: note.trim() || null,
        expiresAt: isComped ? expiresAtIso : null,
      });

      toast({
        title: "Billing override updated",
        description: `${editingProfile.company_name || editingProfile.tenant_name} is now ${
          isComped ? "comped" : "billable"
        }.`,
      });

      closeUpdateDialog();
      await refetch(filter);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to update billing override.";
      toast({
        variant: "destructive",
        title: "Update failed",
        description: message,
      });
    }
  };

  const handleOpenHistory = async (profile: TenantBillingOverrideProfile) => {
    setHistoryProfile(profile);
    setHistoryLoading(true);
    try {
      const entries = await fetchTenantLog(profile.tenant_id, 100);
      setHistoryEntries(entries);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load override history.";
      toast({
        variant: "destructive",
        title: "History load failed",
        description: message,
      });
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleFilterChange = async (value: BillingOverrideFilter) => {
    setFilter(value);
    await refetch(value);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          primaryText="Billing Overrides"
          accentText="Ops"
          description="Admin-dev controls for multi-tenant comped billing overrides and audit history."
        />

        <div className="flex flex-wrap justify-between gap-2">
          <BackToDevConsoleButton />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/stripe-ops">
                <MaterialIcon name="credit_card" size="sm" className="mr-2" />
                Open Stripe Ops
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/pricing-ops">
                <MaterialIcon name="tune" size="sm" className="mr-2" />
                Open Pricing Ops
              </Link>
            </Button>
          </div>
        </div>

        <Alert>
          <MaterialIcon name="info" size="sm" />
          <AlertDescription className="text-sm">
            Active comped overrides bypass subscription gating and disable tenant checkout/portal billing
            actions. Pricing notices also exclude comped tenants.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Tenant Billing Overrides</CardTitle>
              <CardDescription>Manage comped status across multiple internal tenants.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="override-filter" className="text-xs text-muted-foreground">
                Filter
              </Label>
              <Select value={filter} onValueChange={(value) => void handleFilterChange(value as BillingOverrideFilter)}>
                <SelectTrigger id="override-filter" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants</SelectItem>
                  <SelectItem value="comped">Comped only</SelectItem>
                  <SelectItem value="not_comped">Not comped</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <MaterialIcon name="progress_activity" size="md" className="animate-spin text-muted-foreground" />
              </div>
            ) : sortedProfiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tenant rows found for this filter.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Comped</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProfiles.map((profile) => (
                      <TableRow key={profile.tenant_id}>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">{profile.company_name || profile.tenant_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {profile.app_subdomain ? `${profile.app_subdomain} • ` : ""}
                              {profile.company_email || "No company_email"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={profile.is_comped ? "default" : "outline"}>
                            {profile.is_comped ? "comped" : "billable"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(profile.subscription_status)}>
                            {profile.subscription_status}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(profile.expires_at)}</TableCell>
                        <TableCell className="max-w-[280px] truncate">
                          {profile.comped_reason || "—"}
                        </TableCell>
                        <TableCell>{formatDate(profile.override_updated_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {profile.is_comped ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openUpdateDialog(profile, false)}
                              >
                                Remove Comped
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openUpdateDialog(profile, true)}
                              >
                                Set Comped
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void handleOpenHistory(profile)}
                            >
                              History
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(editingProfile)} onOpenChange={(open) => !open && closeUpdateDialog()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{isComped ? "Enable Comped Override" : "Disable Comped Override"}</DialogTitle>
            <DialogDescription>
              {editingProfile?.company_name || editingProfile?.tenant_name} ({editingProfile?.tenant_id})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {isComped ? (
              <>
                <div className="space-y-1.5">
                  <Label>Comped Reason</Label>
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Internal tenant / QA / partner waiver..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Expires At (optional)</Label>
                  <Input
                    type="datetime-local"
                    value={expiresAtLocal}
                    onChange={(e) => setExpiresAtLocal(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <Alert>
                <MaterialIcon name="warning" size="sm" />
                <AlertDescription className="text-sm">
                  Disabling the comped override re-enables normal Stripe billing flows for this tenant.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <Label>Internal Note</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional audit note..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeUpdateDialog}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleApplyOverride()} disabled={updating}>
              {updating ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : isComped ? (
                "Enable Comped"
              ) : (
                "Disable Comped"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyProfile)} onOpenChange={(open) => !open && setHistoryProfile(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Billing Override History</DialogTitle>
            <DialogDescription>
              {historyProfile?.company_name || historyProfile?.tenant_name} ({historyProfile?.tenant_id})
            </DialogDescription>
          </DialogHeader>

          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <MaterialIcon name="progress_activity" size="md" className="animate-spin text-muted-foreground" />
            </div>
          ) : historyEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No override events recorded yet.</p>
          ) : (
            <ScrollArea className="h-[360px] pr-3">
              <div className="space-y-3">
                {historyEntries.map((entry) => (
                  <div key={entry.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{entry.event_type}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDate(entry.created_at)}</span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Status: {entry.is_comped ? "comped" : "billable"}
                    </p>
                    {entry.reason && (
                      <p className="mt-2">
                        <span className="font-medium">Reason:</span> {entry.reason}
                      </p>
                    )}
                    {entry.note && (
                      <p className="mt-1">
                        <span className="font-medium">Note:</span> {entry.note}
                      </p>
                    )}
                    {entry.expires_at && (
                      <p className="mt-1">
                        <span className="font-medium">Expires:</span> {formatDate(entry.expires_at)}
                      </p>
                    )}
                    {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                      <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                        {JSON.stringify(entry.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
