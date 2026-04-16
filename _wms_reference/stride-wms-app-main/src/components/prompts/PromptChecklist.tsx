import { useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ChecklistItem } from '@/types/guidedPrompts';

interface PromptChecklistProps {
  items: ChecklistItem[];
  onChange: (state: Record<string, boolean>) => void;
  disabled?: boolean;
}

export function PromptChecklist({ items, onChange, disabled = false }: PromptChecklistProps) {
  const [checkState, setCheckState] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    items.forEach(item => {
      initial[item.key] = false;
    });
    return initial;
  });

  useEffect(() => {
    onChange(checkState);
  }, [checkState, onChange]);

  const handleCheck = (key: string, checked: boolean) => {
    setCheckState(prev => ({
      ...prev,
      [key]: checked,
    }));
  };

  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.key} className="flex items-start space-x-3">
          <Checkbox
            id={item.key}
            checked={checkState[item.key]}
            onCheckedChange={(checked) => handleCheck(item.key, checked === true)}
            disabled={disabled}
          />
          <Label
            htmlFor={item.key}
            className="text-sm leading-tight cursor-pointer"
          >
            {item.label}
            {item.required && <span className="text-red-500 ml-1">*</span>}
          </Label>
        </div>
      ))}
    </div>
  );
}
