import { useState, useCallback, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PromptChecklist } from './PromptChecklist';
import { GuidedPrompt, PromptButton, PromptContext } from '@/types/guidedPrompts';

interface PromptSlidePanelProps {
  prompt: GuidedPrompt;
  context?: PromptContext;
  onConfirm: (checklistState?: Record<string, boolean>) => void;
  onCancel: () => void;
  onSkip?: () => void;
}

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

export function PromptSlidePanel({
  prompt,
  context,
  onConfirm,
  onCancel,
  onSkip,
}: PromptSlidePanelProps) {
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});
  const isMobile = useIsMobile();

  const handleChecklistChange = useCallback((state: Record<string, boolean>) => {
    setChecklistState(state);
  }, []);

  const isChecklistComplete = useCallback(() => {
    if (!prompt.checklist_items) return true;

    const requiredItems = prompt.checklist_items.filter(item => item.required);
    return requiredItems.every(item => checklistState[item.key]);
  }, [prompt.checklist_items, checklistState]);

  const handleButtonClick = (button: PromptButton) => {
    switch (button.action) {
      case 'confirm':
        onConfirm(checklistState);
        break;
      case 'cancel':
        onCancel();
        break;
      case 'skip':
        onSkip?.();
        break;
      default:
        onConfirm(checklistState);
    }
  };

  const defaultButtons: PromptButton[] = prompt.buttons || [
    { key: 'confirm', label: 'Continue', variant: 'default', action: 'confirm' },
  ];

  // Use bottom sheet on mobile for better UX with touch gestures
  const sheetSide = isMobile ? 'bottom' : 'right';

  return (
    <Sheet open onOpenChange={() => onCancel()}>
      <SheetContent
        side={sheetSide}
        className={
          isMobile
            ? 'h-auto max-h-[85vh] rounded-t-xl'
            : 'w-full sm:max-w-md'
        }
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MaterialIcon name="school" className="text-blue-600" />
            {prompt.title}
          </SheetTitle>
          <SheetDescription className="text-base pt-2">
            {prompt.message}
          </SheetDescription>
        </SheetHeader>

        <div className="py-6 space-y-4">
          {prompt.tip_text && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              <MaterialIcon name="lightbulb" size="sm" className="inline mr-2" />
              {prompt.tip_text}
            </div>
          )}

          {prompt.checklist_items && prompt.checklist_items.length > 0 && (
            <div className="pt-2">
              <PromptChecklist
                items={prompt.checklist_items}
                onChange={handleChecklistChange}
              />
            </div>
          )}
        </div>

        <SheetFooter className="flex-col gap-2">
          {defaultButtons.map(button => (
            <Button
              key={button.key}
              variant={button.variant || 'default'}
              onClick={() => handleButtonClick(button)}
              disabled={
                button.action === 'confirm' &&
                prompt.requires_confirmation &&
                !isChecklistComplete()
              }
              className="w-full"
            >
              {button.label}
            </Button>
          ))}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
