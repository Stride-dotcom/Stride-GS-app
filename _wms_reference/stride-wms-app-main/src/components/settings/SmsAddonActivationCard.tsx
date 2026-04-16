import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { TenantCompanySettings } from "@/hooks/useTenantSettings";
import { useSmsAddonActivation } from "@/hooks/useSmsAddonActivation";
import { useSmsSenderProvisioning } from "@/hooks/useSmsSenderProvisioning";
import { useToast } from "@/hooks/use-toast";

const SMS_TERMS_VERSION = "sms-addon-v1";

interface SmsAddonActivationCardProps {
  settings: TenantCompanySettings | null;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

function isSenderApproved(status: string): boolean {
  return status === "approved";
}

export function SmsAddonActivationCard({ settings }: SmsAddonActivationCardProps) {
  const { toast } = useToast();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  const {
    data: activationState,
    isLoading,
    activateSmsAddon,
    isActivating,
    deactivateSmsAddon,
    isDeactivating,
  } = useSmsAddonActivation();
  const {
    data: senderProfile,
    isLoading: senderLoading,
    requestProvisioning,
    isRequestingProvisioning,
  } = useSmsSenderProvisioning();
  const senderStatus = senderProfile?.provisioning_status ?? "not_requested";

  const readinessItems = useMemo(
    () => [
      {
        id: "sender",
        label: "Platform-managed toll-free sender verification approved",
        ready: isSenderApproved(senderStatus),
      },
      {
        id: "proof-consent",
        label: "Proof of consent URL (HTTPS)",
        ready: isHttpsUrl(settings?.sms_proof_of_consent_url),
      },
      {
        id: "privacy",
        label: "Privacy policy URL (HTTPS)",
        ready: isHttpsUrl(settings?.sms_privacy_policy_url),
      },
      {
        id: "terms",
        label: "Terms URL (HTTPS)",
        ready: isHttpsUrl(settings?.sms_terms_conditions_url),
      },
      {
        id: "compliance-copy",
        label: "Compliance messages completed (opt-in/help/stop)",
        ready:
          hasText(settings?.sms_opt_in_message) &&
          hasText(settings?.sms_help_message) &&
          hasText(settings?.sms_stop_message),
      },
      {
        id: "use-case",
        label: "Use case + sample message completed",
        ready: hasText(settings?.sms_use_case_description) && hasText(settings?.sms_sample_message),
      },
    ],
    [senderStatus, settings]
  );

  const readyCount = readinessItems.filter((item) => item.ready).length;
  const checklistComplete = readyCount === readinessItems.length;
  const isActive = activationState?.is_active === true;
  const activationStatus = activationState?.activation_status ?? "not_activated";
  const senderPhone = senderProfile?.twilio_phone_number_e164 ?? "—";

  const statusLabel: Record<string, string> = {
    active: "Active",
    disabled: "Disabled",
    paused: "Paused",
    not_activated: "Not Activated",
  };

  const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    disabled: "destructive",
    paused: "secondary",
    not_activated: "outline",
  };
  const senderStatusLabel: Record<string, string> = {
    not_requested: "Not Requested",
    requested: "Requested",
    provisioning: "Provisioning",
    pending_verification: "Pending Verification",
    approved: "Approved",
    rejected: "Rejected",
    disabled: "Disabled",
  };
  const senderStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    not_requested: "outline",
    requested: "secondary",
    provisioning: "secondary",
    pending_verification: "secondary",
    approved: "default",
    rejected: "destructive",
    disabled: "destructive",
  };

  const handleActivate = async () => {
    if (!acceptedTerms) {
      toast({
        variant: "destructive",
        title: "Terms confirmation required",
        description: "Please confirm terms acceptance before activating SMS add-on.",
      });
      return;
    }

    try {
      await activateSmsAddon({
        termsVersion: SMS_TERMS_VERSION,
        acceptanceSource: "settings_sms_activation_card",
      });

      setAcceptedTerms(false);
      toast({
        title: isActive ? "SMS terms updated" : "SMS add-on activated",
        description:
          "Terms acceptance has been recorded with audit metadata (version, time, user, IP, user-agent, source).",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to activate SMS add-on.";
      toast({
        variant: "destructive",
        title: "Activation failed",
        description: message,
      });
    }
  };

  const handleDeactivate = async () => {
    try {
      await deactivateSmsAddon({
        reason: "self_deactivation",
        acceptanceSource: "settings_sms_activation_card",
      });
      setDeactivateConfirmOpen(false);
      setAcceptedTerms(false);
      toast({
        title: "SMS add-on deactivated",
        description: "SMS add-on was deactivated and SMS sending was turned off for your tenant.",
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to deactivate SMS add-on.";
      toast({
        variant: "destructive",
        title: "Deactivation failed",
        description: message,
      });
    }
  };

  const handleRequestProvisioning = async () => {
    try {
      await requestProvisioning({
        requestSource: "settings_sms_activation_card",
      });
      toast({
        title: "Provisioning requested",
        description:
          "Toll-free sender provisioning request submitted. SMS remains disabled until verification is approved.",
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to request sender provisioning.";
      toast({
        variant: "destructive",
        title: "Request failed",
        description: message,
      });
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="add_task" size="md" />
          SMS Add-On Activation
        </CardTitle>
        <CardDescription>
          Platform-managed SMS setup: request a toll-free sender, complete compliance fields, then
          activate terms acceptance.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Sender Provisioning</p>
              <Badge variant={senderStatusVariant[senderStatus] || "secondary"}>
                {senderStatusLabel[senderStatus] || senderStatus}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleRequestProvisioning()}
              disabled={
                senderLoading ||
                isRequestingProvisioning ||
                senderStatus === "requested" ||
                senderStatus === "provisioning" ||
                senderStatus === "pending_verification" ||
                senderStatus === "approved"
              }
            >
              {isRequestingProvisioning ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Requesting...
                </>
              ) : (
                <>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Request Toll-Free Sender
                </>
              )}
            </Button>
          </div>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div>Requested at: {formatDate(senderProfile?.requested_at ?? null)}</div>
            <div>Verification submitted: {formatDate(senderProfile?.verification_submitted_at ?? null)}</div>
            <div>Verification approved: {formatDate(senderProfile?.verification_approved_at ?? null)}</div>
            <div>Assigned number: {senderPhone}</div>
          </div>
          {senderStatus === "rejected" && senderProfile?.last_error && (
            <Alert variant="destructive">
              <MaterialIcon name="error" size="sm" />
              <AlertDescription className="text-sm">{senderProfile.last_error}</AlertDescription>
            </Alert>
          )}
        </div>

        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
          <MaterialIcon name="info" size="sm" className="text-amber-700 dark:text-amber-300" />
          <AlertDescription className="text-sm text-amber-900 dark:text-amber-200">
            SMS sending stays disabled until toll-free verification is approved by platform ops.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant[activationStatus] || "secondary"}>
            {statusLabel[activationStatus] || activationStatus}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Terms version: {activationState?.terms_version ?? "—"}
          </span>
        </div>

        {activationStatus === "disabled" && (
          <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900">
            <MaterialIcon name="info" size="sm" className="text-amber-700 dark:text-amber-300" />
            <AlertDescription className="text-sm text-amber-900 dark:text-amber-200">
              SMS add-on is currently disabled. Re-confirm terms to reactivate once sender verification
              is approved.
            </AlertDescription>
          </Alert>
        )}

        <Alert className="bg-muted/50 border-muted-foreground/20">
          <MaterialIcon name="shield" size="sm" />
          <AlertDescription className="text-sm">
            Activation captures compliance evidence for terms acceptance: version, accepted timestamp, accepted-by user
            id, IP address, user-agent, and acceptance source.
          </AlertDescription>
        </Alert>

        <div className="border rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Activation readiness checklist</h4>
            <Badge variant={checklistComplete ? "default" : "secondary"}>
              {readyCount}/{readinessItems.length} complete
            </Badge>
          </div>
          <div className="grid gap-2">
            {readinessItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <MaterialIcon
                  name={item.ready ? "check_circle" : "radio_button_unchecked"}
                  size="sm"
                  className={item.ready ? "text-green-600" : "text-muted-foreground"}
                />
                <span className={item.ready ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="sms-addon-terms"
              checked={acceptedTerms}
              onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
            />
            <Label htmlFor="sms-addon-terms" className="text-sm font-normal leading-5">
              I confirm we agree to the SMS add-on terms (version: <span className="font-medium">{SMS_TERMS_VERSION}</span>)
              and that our consent workflow is configured.
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Reactivating SMS add-on requires terms re-acceptance each time.
          </p>

          {settings?.sms_terms_conditions_url && (
            <Button
              type="button"
              variant="link"
              className="px-0 h-auto text-xs"
              onClick={() => window.open(settings.sms_terms_conditions_url || "", "_blank", "noopener,noreferrer")}
            >
              <MaterialIcon name="open_in_new" size="sm" className="mr-1" />
              Open configured SMS terms URL
            </Button>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
          <div>Activated at: {formatDate(activationState?.activated_at ?? null)}</div>
          <div>Last terms accepted at: {formatDate(activationState?.terms_accepted_at ?? null)}</div>
        </div>

        <div className="flex justify-end gap-2">
          {isActive && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeactivateConfirmOpen(true)}
              disabled={isLoading || isActivating || isDeactivating}
            >
              <MaterialIcon name="block" size="sm" className="mr-2" />
              Deactivate SMS Add-On
            </Button>
          )}
          <Button
            type="button"
            onClick={() => void handleActivate()}
            disabled={
              isLoading ||
              senderLoading ||
              isActivating ||
              isDeactivating ||
              isRequestingProvisioning ||
              !acceptedTerms ||
              !checklistComplete
            }
          >
            {isActivating ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Saving...
              </>
            ) : isActive ? (
              "Re-confirm Terms"
            ) : (
              "Activate SMS Add-On"
            )}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={deactivateConfirmOpen} onOpenChange={setDeactivateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate SMS add-on?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disable SMS add-on billing status for your tenant and turn off SMS sending. You can reactivate
              later by completing the checklist and accepting terms again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDeactivate();
              }}
              disabled={isDeactivating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeactivating ? "Deactivating..." : "Yes, Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
