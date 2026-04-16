import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { GuidedPrompt, PromptContext } from '@/types/guidedPrompts';

interface PromptToastProps {
  prompt: GuidedPrompt;
  context?: PromptContext;
  onDismiss: () => void;
}

export function PromptToast({ prompt, context, onDismiss }: PromptToastProps) {
  const { toast } = useToast();

  useEffect(() => {
    toast({
      title: prompt.title,
      description: prompt.message,
      duration: 5000,
    });

    // Auto-dismiss after showing
    onDismiss();
  }, [prompt, toast, onDismiss]);

  // This component doesn't render anything - it just triggers the toast
  return null;
}
