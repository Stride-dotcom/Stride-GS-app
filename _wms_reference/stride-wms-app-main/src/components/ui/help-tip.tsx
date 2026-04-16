import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useGlobalHelpTools } from '@/hooks/useGlobalHelpTools';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  buildAutoFieldKeyFromTooltip,
  cleanHelpRuntimeQuery,
  getGlobalHelpLastRouteStorageKey,
  HELP_QUERY_FIELD,
  HELP_QUERY_PAGE,
  HELP_QUERY_SELECTOR,
  resolveHelpPageKeyFromLocation,
} from '@/lib/globalHelpToolsCatalog';

interface HelpTipProps {
  /** The help text to display in the popover */
  tooltip: string;
  /** Optional page key for centralized help overrides */
  pageKey?: string;
  /** Optional field key for centralized help overrides */
  fieldKey?: string;
  /** Optional children to render alongside the help icon */
  children?: ReactNode;
  /** Side for the popover placement */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Additional CSS classes for the wrapper */
  className?: string;
}

/**
 * HelpTip — contextual help icon for non-label contexts (headers, buttons, settings).
 * Click/tap only to open a popover with help text.
 */
export function HelpTip({ tooltip, pageKey, fieldKey, children, side = 'top', className }: HelpTipProps) {
  const location = useLocation();
  const resolvedPageKey = pageKey || resolveHelpPageKeyFromLocation(location.pathname, location.search);
  const resolvedFieldKey = fieldKey || buildAutoFieldKeyFromTooltip(tooltip);
  const fallbackAutoFieldKey = buildAutoFieldKeyFromTooltip(tooltip);
  const { data: allTools = [] } = useGlobalHelpTools();
  const tool = useMemo(() => {
    const primary = allTools.find(
      (entry) => entry.page_key === resolvedPageKey && entry.field_key === resolvedFieldKey
    );
    if (primary) return primary;
    return allTools.find(
      (entry) => entry.page_key === resolvedPageKey && entry.field_key === fallbackAutoFieldKey
    ) || null;
  }, [allTools, fallbackAutoFieldKey, resolvedFieldKey, resolvedPageKey]);
  const displayText = tool?.help_text || tooltip;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(false);

  useEffect(() => {
    if (!resolvedPageKey || typeof window === 'undefined') return;
    const query = cleanHelpRuntimeQuery(location.search);
    const currentRoute = `${location.pathname}${query ? `?${query}` : ''}`;
    window.localStorage.setItem(getGlobalHelpLastRouteStorageKey(resolvedPageKey), currentRoute);
  }, [location.pathname, location.search, resolvedPageKey]);

  useEffect(() => {
    if (!resolvedPageKey || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const targetPage = params.get(HELP_QUERY_PAGE);
    const targetField = params.get(HELP_QUERY_FIELD);
    const acceptedFields = [resolvedFieldKey, fallbackAutoFieldKey, tool?.field_key].filter(Boolean);
    if (targetPage !== resolvedPageKey || !acceptedFields.includes(targetField || '')) return;

    const trigger = triggerRef.current;
    if (!trigger || trigger.getClientRects().length === 0) return;

    window.requestAnimationFrame(() => {
      const selector = params.get(HELP_QUERY_SELECTOR);
      if (selector) {
        const focusTarget = document.querySelector(selector) as HTMLElement | null;
        if (focusTarget) {
          focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
          if (
            ['input', 'select', 'textarea', 'button'].includes(focusTarget.tagName.toLowerCase()) ||
            focusTarget.getAttribute('tabindex') !== null ||
            focusTarget.getAttribute('contenteditable') === 'true'
          ) {
            focusTarget.focus();
          }
          const previous = focusTarget.style.boxShadow;
          focusTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.65)';
          window.setTimeout(() => {
            focusTarget.style.boxShadow = previous;
          }, 3000);
        }
      }
      trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
      trigger.focus();
      setOpen(true);
      setHighlighted(true);
      window.setTimeout(() => setHighlighted(false), 3000);
    });
  }, [fallbackAutoFieldKey, location.pathname, location.search, resolvedFieldKey, resolvedPageKey, tool?.field_key]);

  if (tool && tool.is_active === false) {
    return <span className={`inline-flex items-center gap-1 ${className || ''}`}>{children}</span>;
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className || ''}`}>
      {children}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            className="group inline-flex items-center justify-center -m-1 p-1 rounded-md transition shrink-0 cursor-help touch-manipulation"
            aria-label="Help"
            aria-haspopup="dialog"
            data-help-page-key={resolvedPageKey}
            data-help-field-key={tool?.field_key || resolvedFieldKey}
          >
            <span
              className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground transition group-hover:bg-muted/80 ${
                highlighted ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
              }`}
            >
              <MaterialIcon name="info" size="sm" className="text-[12px]" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent side={side} className="max-w-[280px] text-xs leading-relaxed p-3">
          <p>{displayText}</p>
        </PopoverContent>
      </Popover>
    </span>
  );
}
