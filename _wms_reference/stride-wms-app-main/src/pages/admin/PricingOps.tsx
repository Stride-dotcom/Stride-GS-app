import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useSaasPricingAdmin } from "@/hooks/useSaasPricingAdmin";
import { BackToDevConsoleButton } from "@/components/admin/BackToDevConsoleButton";

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
}

function parseAmountInput(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export default function PricingOps() {
  const { toast } = useToast();
  const {
    versions,
    dispatches,
    effectivePricing,
    loading,
    saving,
    sendingNotice,
    createPricingVersion,
    sendPricingNotice,
    versionStatusById,
  } = useSaasPricingAdmin();

  const [effectiveFromLocal, setEffectiveFromLocal] = useState<string>(
    toLocalDateTimeInputValue(new Date())
  );
  const [appMonthlyFee, setAppMonthlyFee] = useState<string>("0");
  const [smsMonthlyAddonFee, setSmsMonthlyAddonFee] = useState<string>("0");
  const [smsSegmentFee, setSmsSegmentFee] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");
  const [activeNoticeVersionId, setActiveNoticeVersionId] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      Boolean(effectiveFromLocal) &&
      Number.isFinite(Number.parseFloat(appMonthlyFee)) &&
      Number.isFinite(Number.parseFloat(smsMonthlyAddonFee)) &&
      Number.isFinite(Number.parseFloat(smsSegmentFee))
    );
  }, [appMonthlyFee, effectiveFromLocal, smsMonthlyAddonFee, smsSegmentFee]);

  const handleSaveVersion = async () => {
    if (!canSubmit) {
      toast({
        variant: "destructive",
        title: "Invalid pricing values",
        description: "Review effective date and fee values before saving.",
      });
      return;
    }

    const effectiveDate = new Date(effectiveFromLocal);
    if (Number.isNaN(effectiveDate.getTime())) {
      toast({
        variant: "destructive",
        title: "Invalid effective date",
        description: "Provide a valid date/time for when this pricing should take effect.",
      });
      return;
    }

    try {
      await createPricingVersion({
        effectiveFrom: effectiveDate.toISOString(),
        appMonthlyFee: parseAmountInput(appMonthlyFee),
        smsMonthlyAddonFee: parseAmountInput(smsMonthlyAddonFee),
        smsSegmentFee: parseAmountInput(smsSegmentFee),
        notes: notes.trim() || null,
      });

      toast({
        title: "Pricing saved",
        description: "New global pricing version has been scheduled.",
      });

      setNotes("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to save pricing version.";
      toast({
        variant: "destructive",
        title: "Save failed",
        description: message,
      });
    }
  };

  const handleSendNotice = async (
    pricingVersionId: string,
    noticeType: "upcoming" | "effective_today"
  ) => {
    setActiveNoticeVersionId(pricingVersionId);
    try {
      const result = await sendPricingNotice({
        pricingVersionId,
        noticeType,
      });

      toast({
        title: "Notice dispatch complete",
        description: `Sent ${result.sent_count} notice email(s); ${result.failed_count} failed.`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to send notice emails.";
      toast({
        variant: "destructive",
        title: "Notice dispatch failed",
        description: message,
      });
    } finally {
      setActiveNoticeVersionId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          primaryText="Pricing"
          accentText="Ops"
          description="Admin-dev console for global app/SMS pricing schedules and subscriber notice dispatch."
        />

        <div className="flex flex-wrap justify-between gap-2">
          <BackToDevConsoleButton />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/billing-overrides-ops">
                <MaterialIcon name="money_off" size="sm" className="mr-2" />
                Open Billing Overrides Ops
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/sms-sender-ops">
                <MaterialIcon name="sms" size="sm" className="mr-2" />
                Open SMS Sender Ops
              </Link>
            </Button>
          </div>
        </div>

        <Alert>
          <MaterialIcon name="info" size="sm" />
          <AlertDescription className="text-sm">
            Notices are sent to subscriber <span className="font-medium">company_email</span> values only.
            This console manages global rates for app monthly fee, SMS monthly add-on, and SMS per-segment fee.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Current Effective Pricing</CardTitle>
            <CardDescription>
              Effective at{" "}
              {effectivePricing.effective_from
                ? format(new Date(effectivePricing.effective_from), "PPP p")
                : "not configured"}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">App Monthly Fee</p>
              <p className="text-lg font-semibold">{formatMoney(effectivePricing.app_monthly_fee)}</p>
            </div>
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">SMS Monthly Add-On</p>
              <p className="text-lg font-semibold">
                {formatMoney(effectivePricing.sms_monthly_addon_fee)}
              </p>
            </div>
            <div className="rounded border p-3">
              <p className="text-xs text-muted-foreground">SMS Per Segment</p>
              <p className="text-lg font-semibold">{formatMoney(effectivePricing.sms_segment_fee)}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule Pricing Version</CardTitle>
            <CardDescription>Create a new effective-dated global pricing version.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="effective-from">Effective From</Label>
                <Input
                  id="effective-from"
                  type="datetime-local"
                  value={effectiveFromLocal}
                  onChange={(e) => setEffectiveFromLocal(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-monthly">App Monthly Fee</Label>
                <Input
                  id="app-monthly"
                  type="number"
                  min={0}
                  step="0.01"
                  value={appMonthlyFee}
                  onChange={(e) => setAppMonthlyFee(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-monthly">SMS Monthly Add-On Fee</Label>
                <Input
                  id="sms-monthly"
                  type="number"
                  min={0}
                  step="0.01"
                  value={smsMonthlyAddonFee}
                  onChange={(e) => setSmsMonthlyAddonFee(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sms-segment">SMS Per-Segment Fee</Label>
                <Input
                  id="sms-segment"
                  type="number"
                  min={0}
                  step="0.0001"
                  value={smsSegmentFee}
                  onChange={(e) => setSmsSegmentFee(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pricing-notes">Notes (optional)</Label>
              <Textarea
                id="pricing-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal note for this price change..."
                rows={2}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEffectiveFromLocal(toLocalDateTimeInputValue(new Date()))}
              >
                Set Effective Now
              </Button>
              <Button type="button" onClick={() => void handleSaveVersion()} disabled={saving || !canSubmit}>
                {saving ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="save" size="sm" className="mr-2" />
                    Save Pricing Version
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pricing Versions</CardTitle>
            <CardDescription>
              Send subscriber price-change notices for upcoming or effective-now changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <MaterialIcon name="progress_activity" size="md" className="animate-spin text-muted-foreground" />
              </div>
            ) : versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pricing versions created yet.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective From</TableHead>
                      <TableHead>App Monthly</TableHead>
                      <TableHead>SMS Monthly</TableHead>
                      <TableHead>SMS Segment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((version) => {
                      const status = versionStatusById[version.id] ?? "historical";
                      return (
                        <TableRow key={version.id}>
                          <TableCell>{format(new Date(version.effective_from), "PPP p")}</TableCell>
                          <TableCell>{formatMoney(version.app_monthly_fee)}</TableCell>
                          <TableCell>{formatMoney(version.sms_monthly_addon_fee)}</TableCell>
                          <TableCell>{formatMoney(version.sms_segment_fee)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                status === "active"
                                  ? "default"
                                  : status === "upcoming"
                                  ? "secondary"
                                  : "outline"
                              }
                            >
                              {status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  sendingNotice && activeNoticeVersionId === version.id
                                }
                                onClick={() =>
                                  void handleSendNotice(version.id, "upcoming")
                                }
                              >
                                Upcoming Notice
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={
                                  sendingNotice && activeNoticeVersionId === version.id
                                }
                                onClick={() =>
                                  void handleSendNotice(version.id, "effective_today")
                                }
                              >
                                Effective Today
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notice Dispatch History</CardTitle>
            <CardDescription>Audit trail of pricing notice sends.</CardDescription>
          </CardHeader>
          <CardContent>
            {dispatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pricing notice dispatches yet.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sent At</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Recipients</TableHead>
                      <TableHead>Pricing Version</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispatches.map((dispatch) => (
                      <TableRow key={dispatch.id}>
                        <TableCell>{format(new Date(dispatch.sent_at), "PPP p")}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{dispatch.notice_type}</Badge>
                        </TableCell>
                        <TableCell>{dispatch.recipient_count}</TableCell>
                        <TableCell className="font-mono text-xs">{dispatch.pricing_version_id}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

