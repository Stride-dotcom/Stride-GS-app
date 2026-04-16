import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Label } from '@/components/ui/label';
import { HelpTip } from '@/components/ui/help-tip';
import { resolveHelpPageKeyFromLocation } from '@/lib/globalHelpToolsCatalog';

interface LabelWithTooltipProps {
  htmlFor?: string;
  children: ReactNode;
  tooltip: string;
  required?: boolean;
  className?: string;
  /** Optional explicit page key override for global help mapping. */
  pageKey?: string;
  /** Optional explicit field key override for global help mapping. */
  fieldKey?: string;
}

const toSnakeCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

export function LabelWithTooltip({
  htmlFor,
  children,
  tooltip,
  required,
  className,
  pageKey,
  fieldKey,
}: LabelWithTooltipProps) {
  const location = useLocation();
  const inferredPageKey = pageKey || resolveHelpPageKeyFromLocation(location.pathname, location.search);
  const inferredFieldKey =
    (fieldKey ? toSnakeCase(fieldKey) : undefined) ||
    (htmlFor ? toSnakeCase(htmlFor) : toSnakeCase(typeof children === 'string' ? children : 'field_help'));

  return (
    <div className={`flex items-center gap-1 ${className || ''}`}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {children}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <HelpTip tooltip={tooltip} pageKey={inferredPageKey} fieldKey={inferredFieldKey} side="top" />
    </div>
  );
}
