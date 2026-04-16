import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function EmailReplyForwardingSection() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [platformActive, setPlatformActive] = useState(false);
  const [replyDomain, setReplyDomain] = useState<string | null>(null);
  const [replyToEmail, setReplyToEmail] = useState<string | null>(null);

  const [forwardToEmail, setForwardToEmail] = useState("");
  const [enabled, setEnabled] = useState(false);

  const fetchState = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_get_my_inbound_email_settings");
      if (error) throw error;

      const tenantReplyTo = toNullableString(data?.reply_to_email);
      const fwdTo = toNullableString(data?.forward_to_email);
      const isEnabled = toBoolean(data?.is_enabled, false);
      const platform = data?.platform && typeof data.platform === "object" ? data.platform : {};

      setReplyToEmail(tenantReplyTo);
      setForwardToEmail(fwdTo || "");
      setEnabled(isEnabled);
      setPlatformActive(toBoolean((platform as any)?.is_active, false));
      setReplyDomain(toNullableString((platform as any)?.reply_domain));
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Failed to load reply forwarding",
        description: err?.message || "Unable to load reply forwarding settings.",
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const canSave = useMemo(() => {
    if (!enabled) return true; // can always disable
    return isValidEmail(forwardToEmail);
  }, [enabled, forwardToEmail]);

  const handleSave = async () => {
    if (!profile?.tenant_id) return;
    if (enabled && !isValidEmail(forwardToEmail)) {
      toast({
        variant: "destructive",
        title: "Invalid forward-to email",
        description: "Enter a valid inbox email address where replies should be forwarded.",
      });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_set_my_inbound_email_settings", {
        p_forward_to_email: forwardToEmail.trim(),
        p_is_enabled: enabled,
      });
      if (error) throw error;

      toast({
        title: "Saved",
        description: enabled
          ? "Reply forwarding enabled."
          : "Reply forwarding disabled.",
      });

      // Refresh computed reply address / platform status
      await fetchState();
      return data;
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err?.message || "Unable to save reply forwarding settings.",
      });
    } finally {
      setSaving(false);
    }
  };

  const displayReplyTo = replyToEmail || (profile?.tenant_id && replyDomain ? `${profile.tenant_id}@${replyDomain}` : null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="reply" size="md" />
          Reply Forwarding
        </CardTitle>
        <CardDescription>
          Forward replies from automated emails to an inbox your team monitors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  Enable reply forwarding{" "}
                  {enabled ? (
                    <Badge variant="secondary" className="bg-green-100 text-green-700">On</Badge>
                  ) : (
                    <Badge variant="outline">Off</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  When enabled, outgoing emails can use a tenant-specific Reply-To address that forwards replies to your inbox.
                </div>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {!platformActive && (
              <Alert className="border-amber-200 bg-amber-50">
                <MaterialIcon name="info" size="sm" className="text-amber-700" />
                <AlertDescription className="text-amber-800">
                  Reply forwarding isn’t enabled on the platform yet. You can still save your forward-to inbox now,
                  but replies won’t route until the platform replies domain is configured.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="forward_to_email">Forward replies to</Label>
              <Input
                id="forward_to_email"
                type="email"
                placeholder="ops@yourcompany.com"
                value={forwardToEmail}
                onChange={(e) => setForwardToEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This is where replies will be forwarded. It can be a shared inbox or helpdesk address.
              </p>
            </div>

            <div className="rounded-md border p-3 bg-muted/30 space-y-1">
              <div className="text-sm font-medium">Your tenant Reply-To address</div>
              {displayReplyTo ? (
                <code className="text-xs break-all block">{displayReplyTo}</code>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not available yet (platform replies domain not configured).
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                When enabled, this address will be used as Reply-To for platform-sent emails so customer replies reach you.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={fetchState} disabled={saving}>
                <MaterialIcon name="refresh" size="sm" className="mr-2" />
                Refresh
              </Button>
              <Button onClick={handleSave} disabled={saving || !canSave}>
                {saving ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="save" size="sm" className="mr-2" />
                )}
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

