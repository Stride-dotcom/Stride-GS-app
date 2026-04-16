/**
 * DeclaredValueInlineEditor - Inline edit field for item declared values
 * Saves via rpc_update_item_declared_value to ensure server-side billing delta.
 */

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface DeclaredValueInlineEditorProps {
  itemId: string;
  currentValue: number | null;
  disabled?: boolean;
  onSaved?: (newValue: number, delta: number) => void;
}

export function DeclaredValueInlineEditor({
  itemId,
  currentValue,
  disabled = false,
  onSaved,
}: DeclaredValueInlineEditorProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(currentValue?.toString() || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync with prop changes
  useEffect(() => {
    setValue(currentValue?.toString() || '');
  }, [currentValue]);

  const hasChanged = value !== (currentValue?.toString() || '');

  const handleSave = async () => {
    const dv = parseFloat(value);
    if (!dv || dv <= 0) {
      setError('Must be > 0');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('rpc_update_item_declared_value', {
        p_item_id: itemId,
        p_declared_value: dv,
      });

      if (rpcError) throw rpcError;

      const result = data as Record<string, number | boolean> | null;
      const delta = (result?.delta as number) || 0;

      onSaved?.(dv, delta);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      setError(msg);
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && hasChanged) {
      handleSave();
    }
    if (e.key === 'Escape') {
      setValue(currentValue?.toString() || '');
      setError(null);
      inputRef.current?.blur();
    }
  };

  const handleBlur = () => {
    if (hasChanged && value) {
      handleSave();
    } else if (!value && currentValue) {
      // Revert to original if cleared
      setValue(currentValue.toString());
    }
  };

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-xs">$</span>
      <Input
        ref={inputRef}
        type="number"
        step="0.01"
        min="0.01"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder="0.00"
        className={`w-24 h-7 text-xs font-mono ${error ? 'border-destructive' : ''}`}
        disabled={disabled || saving}
      />
      {saving && (
        <MaterialIcon name="progress_activity" className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {error && (
        <MaterialIcon name="error" className="h-3 w-3 text-destructive" title={error} />
      )}
    </div>
  );
}
