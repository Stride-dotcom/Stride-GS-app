import { type ReactNode } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

type InboundStatusKey = 'draft' | 'stage1_complete' | 'receiving' | 'closed' | 'partial' | 'cancelled';
type TaskStatusKey = 'pending' | 'in_progress' | 'completed' | 'unable_to_complete' | 'cancelled';
type StatusBarType = 'inbound' | 'task';

interface StatusTheme {
  bg: string;
  border: string;
  text: string;
  icon: string;
  label: string;
  pulse: boolean;
  glow: string;
}

export const INBOUND_STATUS_THEME: Record<InboundStatusKey, StatusTheme> = {
  draft: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/35',
    border: 'border-indigo-500/90',
    text: 'text-indigo-900 dark:text-indigo-100',
    icon: 'edit_note',
    label: 'Draft',
    pulse: true,
    glow: 'shadow-[0_0_0_1px_rgba(99,102,241,0.34),0_0_18px_-10px_rgba(99,102,241,0.95)]',
  },
  stage1_complete: {
    bg: 'bg-blue-50 dark:bg-blue-950/35',
    border: 'border-blue-500/90',
    text: 'text-blue-900 dark:text-blue-100',
    icon: 'check_circle',
    label: 'Stage 1 Complete',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(59,130,246,0.34),0_0_18px_-10px_rgba(59,130,246,0.95)]',
  },
  receiving: {
    bg: 'bg-violet-50 dark:bg-violet-950/35',
    border: 'border-violet-500/90',
    text: 'text-violet-900 dark:text-violet-100',
    icon: 'inventory_2',
    label: 'Receiving',
    pulse: true,
    glow: 'shadow-[0_0_0_1px_rgba(139,92,246,0.34),0_0_18px_-10px_rgba(139,92,246,0.95)]',
  },
  closed: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/35',
    border: 'border-emerald-500/90',
    text: 'text-emerald-900 dark:text-emerald-100',
    icon: 'verified',
    label: 'Receiving Complete',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(16,185,129,0.34),0_0_18px_-10px_rgba(16,185,129,0.95)]',
  },
  partial: {
    bg: 'bg-amber-50 dark:bg-amber-950/35',
    border: 'border-amber-500/90',
    text: 'text-amber-900 dark:text-amber-100',
    icon: 'warning',
    label: 'Partial Complete',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(245,158,11,0.34),0_0_18px_-10px_rgba(245,158,11,0.95)]',
  },
  cancelled: {
    bg: 'bg-red-50 dark:bg-red-950/35',
    border: 'border-red-500/90',
    text: 'text-red-900 dark:text-red-100',
    icon: 'cancel',
    label: 'Cancelled',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(239,68,68,0.34),0_0_18px_-10px_rgba(239,68,68,0.95)]',
  },
};

export const TASK_STATUS_THEME: Record<TaskStatusKey, StatusTheme> = {
  pending: {
    bg: 'bg-amber-50 dark:bg-amber-950/35',
    border: 'border-orange-500/95',
    text: 'text-orange-900 dark:text-orange-100',
    icon: 'schedule',
    label: 'Pending',
    pulse: true,
    glow: 'shadow-[0_0_0_1px_rgba(249,115,22,0.36),0_0_20px_-10px_rgba(249,115,22,0.98)]',
  },
  in_progress: {
    bg: 'bg-blue-50 dark:bg-blue-950/35',
    border: 'border-blue-500/95',
    text: 'text-blue-900 dark:text-blue-100',
    icon: 'play_circle',
    label: 'In Progress',
    pulse: true,
    glow: 'shadow-[0_0_0_1px_rgba(59,130,246,0.36),0_0_20px_-10px_rgba(59,130,246,0.98)]',
  },
  completed: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/35',
    border: 'border-emerald-500/95',
    text: 'text-emerald-900 dark:text-emerald-100',
    icon: 'check_circle',
    label: 'Completed',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(16,185,129,0.36),0_0_20px_-10px_rgba(16,185,129,0.98)]',
  },
  unable_to_complete: {
    bg: 'bg-red-50 dark:bg-red-950/35',
    border: 'border-red-500/95',
    text: 'text-red-900 dark:text-red-100',
    icon: 'cancel',
    label: 'Unable to Complete',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(239,68,68,0.36),0_0_20px_-10px_rgba(239,68,68,0.98)]',
  },
  cancelled: {
    bg: 'bg-zinc-100 dark:bg-zinc-900/55',
    border: 'border-zinc-500/95',
    text: 'text-zinc-900 dark:text-zinc-100',
    icon: 'block',
    label: 'Cancelled',
    pulse: false,
    glow: 'shadow-[0_0_0_1px_rgba(113,113,122,0.36),0_0_20px_-10px_rgba(113,113,122,0.98)]',
  },
};

interface StatusBarProps {
  statusKey: InboundStatusKey | TaskStatusKey;
  type?: StatusBarType;
  contextLabel?: string;
  labelOverride?: string;
  children?: ReactNode;
}

export function StatusBar({ statusKey, type = 'inbound', contextLabel, labelOverride, children }: StatusBarProps) {
  const theme =
    type === 'task'
      ? TASK_STATUS_THEME[statusKey as TaskStatusKey] || TASK_STATUS_THEME.pending
      : INBOUND_STATUS_THEME[statusKey as InboundStatusKey] || INBOUND_STATUS_THEME.draft;

  const typeLabel =
    contextLabel ||
    (type === 'task' ? 'Task' : 'Inbound · Dock Intake');

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-2">
      <div
        className={`max-w-[1500px] mx-auto rounded-xl border-2 px-4 py-3 ${theme.bg} ${theme.border} ${theme.text} ${theme.glow}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              {theme.pulse && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-current" />
                </span>
              )}
              <MaterialIcon name={theme.icon} size="sm" />
              <span className="font-semibold text-sm">{labelOverride || theme.label}</span>
            </div>
            <span className="text-xs opacity-75 font-medium">{typeLabel}</span>
          </div>

          {children ? (
            <div className="flex items-center gap-2 flex-wrap">
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
