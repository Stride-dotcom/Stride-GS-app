/**
 * promptResumePausedTask.ts
 *
 * Small event helper so any workflow can trigger the global
 * "Resume paused task?" prompt after completing a job.
 */

export type PromptResumePausedTaskDetail = {
  /** Optional: avoid suggesting the task that just completed. */
  excludeTaskId?: string;
};

export function promptResumePausedTask(detail?: PromptResumePausedTaskDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PromptResumePausedTaskDetail>('stride:prompt-resume-paused-task', {
      detail: detail ?? {},
    })
  );
}

