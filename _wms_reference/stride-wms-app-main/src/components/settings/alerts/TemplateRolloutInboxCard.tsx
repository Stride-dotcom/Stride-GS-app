import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type RolloutMode = "replace_all" | "layout_only" | "do_not_update";

interface PendingRolloutRow {
  rollout_id: string;
  name: string;
  notes: string | null;
  scheduled_for: string;
  status: string;
  update_mode: RolloutMode;
  preserve_subject: boolean;
  preserve_body_text: boolean;
  allow_tenant_opt_out: boolean;
  is_security_critical: boolean;
  security_grace_until: string | null;
  tenant_decision: RolloutMode | null;
  decision_locked: boolean;
}

function modeBadgeLabel(mode: RolloutMode): string {
  if (mode === "replace_all") return "Replace all";
  if (mode === "layout_only") return "Layout only";
  return "Do not update";
}

export function TemplateRolloutInboxCard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingPreference, setSavingPreference] = useState(false);
  const [savingDecisionId, setSavingDecisionId] = useState<string | null>(null);
  const [optOutNonCritical, setOptOutNonCritical] = useState(false);
  const [rollouts, setRollouts] = useState<PendingRolloutRow[]>([]);

  const loadRolloutInbox = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: rolloutData, error: rolloutErr }, { data: prefData, error: prefErr }] =
        await Promise.all([
          (supabase as any).rpc("rpc_list_my_pending_template_rollouts"),
          (supabase as any).rpc("rpc_get_my_template_rollout_preference"),
        ]);
      if (rolloutErr) throw new Error(rolloutErr.message);
      if (prefErr) throw new Error(prefErr.message);

      setRollouts((rolloutData || []) as PendingRolloutRow[]);
      setOptOutNonCritical(Boolean(prefData));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load rollout inbox";
      toast({ variant: "destructive", title: "Template update inbox failed", description: message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadRolloutInbox();
  }, [loadRolloutInbox]);

  const nextUpcomingText = useMemo(() => {
    if (rollouts.length === 0) return null;
    const next = rollouts[0];
    return `Next scheduled rollout: ${next.name} (${new Date(next.scheduled_for).toLocaleString()})`;
  }, [rollouts]);

  const handleTogglePreference = async (checked: boolean) => {
    setSavingPreference(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_set_my_template_rollout_preference", {
        p_opt_out_non_critical: checked,
      });
      if (error) throw new Error(error.message);
      setOptOutNonCritical(Boolean(data));
      toast({
        title: "Template update preference saved",
        description: checked
          ? "Non-critical template rollouts are now opted out by default."
          : "Non-critical template rollouts are now opted in by default.",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save preference";
      toast({ variant: "destructive", title: "Save failed", description: message });
    } finally {
      setSavingPreference(false);
    }
  };

  const handleSetDecision = async (rolloutId: string, decision: RolloutMode) => {
    setSavingDecisionId(rolloutId);
    try {
      const { error } = await (supabase as any).rpc("rpc_set_my_template_rollout_decision", {
        p_rollout_id: rolloutId,
        p_decision: decision,
      });
      if (error) throw new Error(error.message);

      setRollouts((prev) =>
        prev.map((row) =>
          row.rollout_id === rolloutId
            ? {
                ...row,
                tenant_decision: decision,
              }
            : row,
        ),
      );
      toast({ title: "Rollout decision saved", description: `Selected: ${modeBadgeLabel(decision)}` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save rollout decision";
      toast({ variant: "destructive", title: "Decision save failed", description: message });
    } finally {
      setSavingDecisionId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="update" size="md" />
          Template Update Inbox
        </CardTitle>
        <CardDescription>
          Choose how scheduled platform template updates apply to your tenant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <div>
            <div className="text-sm font-medium">Opt out of non-critical rollouts by default</div>
            <div className="text-xs text-muted-foreground">
              Security-critical rollouts still auto-apply after the grace window.
            </div>
          </div>
          <Switch
            checked={optOutNonCritical}
            onCheckedChange={handleTogglePreference}
            disabled={savingPreference || loading}
          />
        </div>

        {nextUpcomingText && (
          <div className="text-xs text-muted-foreground">{nextUpcomingText}</div>
        )}

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : rollouts.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No scheduled template rollouts are pending for your tenant.
          </div>
        ) : (
          <div className="space-y-3">
            {rollouts.map((rollout) => {
              const isLocked = rollout.decision_locked;
              const isSavingThisRow = savingDecisionId === rollout.rollout_id;
              return (
                <div key={rollout.rollout_id} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{rollout.name}</span>
                    <Badge variant="outline">{modeBadgeLabel(rollout.update_mode)}</Badge>
                    {rollout.is_security_critical && <Badge variant="destructive">Security-critical</Badge>}
                    {rollout.tenant_decision && (
                      <Badge variant="secondary">Your choice: {modeBadgeLabel(rollout.tenant_decision)}</Badge>
                    )}
                  </div>
                  <div className="mb-3 text-xs text-muted-foreground">
                    Scheduled for {new Date(rollout.scheduled_for).toLocaleString()}
                    {rollout.security_grace_until
                      ? ` • Grace until ${new Date(rollout.security_grace_until).toLocaleString()}`
                      : ""}
                  </div>
                  {rollout.notes && (
                    <div className="mb-3 text-xs text-muted-foreground">{rollout.notes}</div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={rollout.tenant_decision === "replace_all" ? "default" : "outline"}
                      onClick={() => handleSetDecision(rollout.rollout_id, "replace_all")}
                      disabled={isLocked || isSavingThisRow}
                    >
                      Replace all
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={rollout.tenant_decision === "layout_only" ? "default" : "outline"}
                      onClick={() => handleSetDecision(rollout.rollout_id, "layout_only")}
                      disabled={isLocked || isSavingThisRow}
                    >
                      Layout only
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={rollout.tenant_decision === "do_not_update" ? "default" : "outline"}
                      onClick={() => handleSetDecision(rollout.rollout_id, "do_not_update")}
                      disabled={isLocked || isSavingThisRow}
                    >
                      Do not update
                    </Button>
                    {isLocked && (
                      <Badge variant="outline" className="ml-auto">
                        Decision locked
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
