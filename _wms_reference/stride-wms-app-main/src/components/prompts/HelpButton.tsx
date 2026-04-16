import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PromptWorkflow } from '@/types/guidedPrompts';
import { usePromptContext } from './PromptProvider';
import { cn } from '@/lib/utils';

interface HelpButtonProps {
  workflow: PromptWorkflow;
  className?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  showLabel?: boolean;
}

export function HelpButton({
  workflow,
  className,
  variant = 'ghost',
  size = 'icon',
  showLabel = false,
}: HelpButtonProps) {
  const { openHelpPanel } = usePromptContext();

  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => openHelpPanel(workflow)}
      className={cn('text-muted-foreground hover:text-foreground', className)}
      title="Help"
    >
      <MaterialIcon name="help" size={size === 'sm' ? 'sm' : 'md'} />
      {showLabel && <span className="ml-2">Help</span>}
    </Button>
  );
}
