import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type ConnectionStatus = "connected" | "disconnected" | "not_configured" | "checking";

interface ServiceConnectionBadgeProps {
  status: ConnectionStatus;
  label?: string;
  detail?: string;
  onRecheck?: () => void;
  loading?: boolean;
}

const statusConfig: Record<
  ConnectionStatus,
  { dot: string; bg: string; text: string; pulse: boolean; defaultLabel: string }
> = {
  connected: {
    dot: "bg-green-500",
    bg: "bg-green-500/10 dark:bg-green-400/15",
    text: "text-green-700 dark:text-green-400",
    pulse: true,
    defaultLabel: "Connected",
  },
  disconnected: {
    dot: "bg-red-500",
    bg: "bg-red-500/10 dark:bg-red-400/15",
    text: "text-red-700 dark:text-red-400",
    pulse: false,
    defaultLabel: "Disconnected",
  },
  not_configured: {
    dot: "bg-yellow-500",
    bg: "bg-yellow-500/10 dark:bg-yellow-400/15",
    text: "text-yellow-700 dark:text-yellow-400",
    pulse: false,
    defaultLabel: "Not Configured",
  },
  checking: {
    dot: "bg-gray-400 dark:bg-gray-500",
    bg: "bg-gray-500/10 dark:bg-gray-400/15",
    text: "text-gray-600 dark:text-gray-400",
    pulse: false,
    defaultLabel: "Checking\u2026",
  },
};

export function ServiceConnectionBadge({
  status,
  label,
  detail,
  onRecheck,
  loading,
}: ServiceConnectionBadgeProps) {
  const config = statusConfig[status];
  const displayLabel = label ?? config.defaultLabel;

  const badge = (
    <button
      type="button"
      onClick={onRecheck}
      disabled={loading || !onRecheck}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
        config.bg,
        config.text,
        onRecheck && !loading && "cursor-pointer hover:opacity-80",
        (!onRecheck || loading) && "cursor-default",
      )}
    >
      <span className="relative inline-flex h-2.5 w-2.5 flex-shrink-0">
        <span
          className={cn(
            "absolute inline-flex h-full w-full rounded-full",
            config.dot,
            config.pulse && !loading && "animate-ping opacity-75",
            status === "checking" && "animate-pulse",
          )}
        />
        <span
          className={cn(
            "relative inline-flex h-2.5 w-2.5 rounded-full",
            config.dot,
          )}
        />
      </span>
      <span>{displayLabel}</span>
      {detail && (
        <span className="opacity-70">{detail}</span>
      )}
    </button>
  );

  const tooltipText = onRecheck ? "Click to recheck" : undefined;

  if (!tooltipText) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
