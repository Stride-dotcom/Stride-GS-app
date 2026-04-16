import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { isSubscriptionAccessBlocked, useSubscriptionGate } from "@/hooks/useSubscriptionGate";
import { useAuth } from "@/contexts/AuthContext";

const STATUS_POLL_INTERVAL_MS = 10_000;

type LocationState = {
  from?: {
    pathname?: string;
  };
};

export default function SubscriptionUpdatePayment() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { signOut, profile } = useAuth();
  const { data: gate, refetch, isLoading, isFetching } = useSubscriptionGate();

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunchingPortal, setIsLaunchingPortal] = useState(false);
  const [supportEmail, setSupportEmail] = useState<string | null>(null);
  const hasAutoLaunchedRef = useRef(false);

  const returnPath = useMemo(() => {
    const state = location.state as LocationState | null;
    const candidate = state?.from?.pathname;
    if (!candidate || candidate.startsWith("/subscription/update-payment")) {
      return "/";
    }
    return candidate;
  }, [location.state]);

  const isBlocked = isSubscriptionAccessBlocked(gate);
  const graceUntilText = gate?.grace_until
    ? new Date(gate.grace_until).toLocaleString()
    : null;

  const launchStripePortal = async () => {
    setLaunchError(null);
    setIsLaunchingPortal(true);

    try {
      const { data, error } = await supabase.functions.invoke("create-stripe-portal-session");
      if (error) {
        throw new Error(error.message);
      }

      const portalUrl = (data as { url?: string } | null)?.url;
      if (!portalUrl) {
        throw new Error("Stripe Customer Portal URL was not returned.");
      }

      window.location.assign(portalUrl);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open Stripe Customer Portal.";
      setLaunchError(message);
      toast({
        variant: "destructive",
        title: "Unable to open payment portal",
        description: message,
      });
    } finally {
      setIsLaunchingPortal(false);
    }
  };

  useEffect(() => {
    if (!gate) return;
    if (!isBlocked) {
      navigate(returnPath, { replace: true });
    }
  }, [gate, isBlocked, navigate, returnPath]);

  useEffect(() => {
    if (!gate || !isBlocked || hasAutoLaunchedRef.current) return;
    hasAutoLaunchedRef.current = true;
    void launchStripePortal();
  }, [gate, isBlocked]);

  useEffect(() => {
    if (!gate || !isBlocked) return;

    const intervalId = window.setInterval(() => {
      void refetch();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [gate, isBlocked, refetch]);

  useEffect(() => {
    if (!profile?.tenant_id) return;

    let cancelled = false;

    const fetchSupportEmail = async () => {
      const { data } = await supabase
        .from("tenant_company_settings")
        .select("company_email")
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle();

      if (!cancelled) {
        setSupportEmail(data?.company_email ?? null);
      }
    };

    void fetchSupportEmail();

    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id]);

  const handleCheckStatus = async () => {
    const { data } = await refetch();
    if (!isSubscriptionAccessBlocked(data)) {
      navigate(returnPath, { replace: true });
      return;
    }

    toast({
      title: "Still blocked",
      description: "Payment status is not active yet. Please finish the Stripe update flow and try again.",
    });
  };

  const handleSignOut = async () => {
    await signOut();
    navigate(returnPath.startsWith("/client") ? "/client/login" : "/auth", { replace: true });
  };

  if (isLoading && !gate) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl">Subscription payment update required</CardTitle>
          <CardDescription>
            Access is paused until billing is resolved. This page opens Stripe Customer Portal so payment
            details are updated directly with Stripe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-4 bg-background space-y-2">
            <p className="text-sm">
              <span className="font-medium">Current status:</span> {gate?.status ?? "unknown"}
            </p>
            {graceUntilText && (
              <p className="text-sm">
                <span className="font-medium">Grace deadline:</span> {graceUntilText}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              We re-check subscription status automatically every 10 seconds.
            </p>
          </div>

          {isLaunchingPortal ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
              Opening Stripe Customer Portal...
            </div>
          ) : null}

          {launchError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {launchError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void launchStripePortal()} disabled={isLaunchingPortal}>
              Manage Subscription
            </Button>
            <Button variant="outline" onClick={() => void handleCheckStatus()} disabled={isFetching}>
              Check status now
            </Button>
            <Button variant="ghost" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>

          {supportEmail ? (
            <p className="text-sm text-muted-foreground">
              Need help?{" "}
              <a className="underline" href={`mailto:${supportEmail}`}>
                Contact support
              </a>
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Need help? Contact your account administrator for billing support.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

