import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { GuidedPrompt, PromptWorkflow, PromptTriggerPoint } from '@/types/guidedPrompts';
import { usePromptContext } from './PromptProvider';

// Hook to detect mobile viewport
function useIsMobile(breakpoint: number = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < breakpoint);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  return isMobile;
}

const WORKFLOW_LABELS: Record<PromptWorkflow, string> = {
  receiving: 'Receiving',
  inspection: 'Inspection',
  assembly: 'Assembly',
  repair: 'Repair',
  movement: 'Movement',
  stocktake: 'Stocktake',
  scan_hub: 'Scan Hub',
  outbound: 'Outbound',
  claims: 'Claims',
  will_call: 'Will Call',
};

const TRIGGER_LABELS: Record<PromptTriggerPoint, string> = {
  before: 'Before Task',
  during: 'During Task',
  after: 'After Task',
};

interface HelpPanelProps {
  workflow: PromptWorkflow;
  prompts: GuidedPrompt[];
  isOpen: boolean;
  onClose: () => void;
}

function PromptHelpCard({ prompt }: { prompt: GuidedPrompt }) {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between">
        <h4 className="font-medium text-sm">{prompt.title}</h4>
        <Badge variant="outline" className="text-xs">
          {prompt.prompt_type.replace('_', ' ')}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{prompt.message}</p>
      {prompt.tip_text && (
        <div className="flex items-start gap-2 text-xs text-blue-600 bg-blue-50 rounded p-2">
          <MaterialIcon name="lightbulb" size="sm" className="flex-shrink-0 mt-0.5" />
          <span>{prompt.tip_text}</span>
        </div>
      )}
      {prompt.checklist_items && prompt.checklist_items.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium">Checklist:</span>
          <ul className="list-disc list-inside mt-1">
            {prompt.checklist_items.map(item => (
              <li key={item.key}>
                {item.label}
                {item.required && <span className="text-red-500 ml-1">*</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function HelpPanel({ workflow, prompts, isOpen, onClose }: HelpPanelProps) {
  const isMobile = useIsMobile();

  // Group prompts by trigger point
  const groupedPrompts = prompts.reduce<Record<PromptTriggerPoint, GuidedPrompt[]>>(
    (acc, prompt) => {
      if (!acc[prompt.trigger_point]) {
        acc[prompt.trigger_point] = [];
      }
      acc[prompt.trigger_point].push(prompt);
      return acc;
    },
    { before: [], during: [], after: [] }
  );

  const triggerOrder: PromptTriggerPoint[] = ['before', 'during', 'after'];

  // Use bottom sheet on mobile for better UX with touch gestures
  const sheetSide = isMobile ? 'bottom' : 'right';

  return (
    <Sheet open={isOpen} onOpenChange={() => onClose()}>
      <SheetContent
        side={sheetSide}
        className={
          isMobile
            ? 'h-[80vh] rounded-t-xl overflow-y-auto'
            : 'w-full sm:max-w-lg overflow-y-auto'
        }
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MaterialIcon name="help" className="text-blue-600" />
            {WORKFLOW_LABELS[workflow]} Help
          </SheetTitle>
          <SheetDescription>
            Reference guide for the {WORKFLOW_LABELS[workflow].toLowerCase()} workflow.
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {triggerOrder.map(trigger => {
            const triggerPrompts = groupedPrompts[trigger];
            if (triggerPrompts.length === 0) return null;

            return (
              <div key={trigger}>
                <div className="flex items-center gap-2 mb-3">
                  <MaterialIcon
                    name={
                      trigger === 'before' ? 'start' :
                      trigger === 'during' ? 'pending' : 'check_circle'
                    }
                    size="sm"
                    className="text-muted-foreground"
                  />
                  <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                    {TRIGGER_LABELS[trigger]}
                  </h3>
                </div>
                <div className="space-y-3">
                  {triggerPrompts
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map(prompt => (
                      <PromptHelpCard key={prompt.id} prompt={prompt} />
                    ))}
                </div>
                <Separator className="mt-6" />
              </div>
            );
          })}

          {prompts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <MaterialIcon name="info" size="lg" className="mx-auto mb-2" />
              <p>No help content available for this workflow.</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Wrapper that uses context
export function HelpPanelWithContext() {
  const { isHelpPanelOpen, helpPanelWorkflow, closeHelpPanel, getPromptsForWorkflow } = usePromptContext();

  if (!isHelpPanelOpen || !helpPanelWorkflow) return null;

  const prompts = getPromptsForWorkflow(helpPanelWorkflow);

  return (
    <HelpPanel
      workflow={helpPanelWorkflow}
      prompts={prompts}
      isOpen={isHelpPanelOpen}
      onClose={closeHelpPanel}
    />
  );
}
