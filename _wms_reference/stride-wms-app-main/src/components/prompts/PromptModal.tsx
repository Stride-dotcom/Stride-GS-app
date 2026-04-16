import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PromptChecklist } from './PromptChecklist';
import { GuidedPrompt, ChecklistItem, PromptButton, PromptContext } from '@/types/guidedPrompts';

interface PromptModalProps {
  prompt: GuidedPrompt;
  context?: PromptContext;
  onConfirm: (checklistState?: Record<string, boolean>) => void;
  onCancel: () => void;
  onSkip?: () => void;
}

export function PromptModal({
  prompt,
  context,
  onConfirm,
  onCancel,
  onSkip,
}: PromptModalProps) {
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});

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
    { key: 'confirm', label: 'OK', variant: 'default', action: 'confirm' },
  ];

  return (
    <Dialog open onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="school" className="text-blue-600" />
            {prompt.title}
          </DialogTitle>
          <DialogDescription className="text-base pt-2">
            {prompt.message}
          </DialogDescription>
        </DialogHeader>

        {prompt.tip_text && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            <MaterialIcon name="lightbulb" size="sm" className="inline mr-2" />
            {prompt.tip_text}
          </div>
        )}

        {prompt.checklist_items && prompt.checklist_items.length > 0 && (
          <div className="py-4">
            <PromptChecklist
              items={prompt.checklist_items}
              onChange={handleChecklistChange}
            />
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
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
              className="w-full sm:w-auto"
            >
              {button.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
