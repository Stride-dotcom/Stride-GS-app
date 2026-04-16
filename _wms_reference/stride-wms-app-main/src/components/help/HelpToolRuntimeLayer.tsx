import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useGlobalHelpTools, type GlobalHelpTool } from '@/hooks/useGlobalHelpTools';
import {
  cleanHelpRuntimeQuery,
  HELP_PICKER_CHANNEL,
  HELP_PICKER_MODE,
  HELP_PICKER_PAGE,
  HELP_QUERY_FIELD,
  HELP_QUERY_PAGE,
  HELP_QUERY_RETURN,
  HELP_QUERY_SELECTOR,
  matchesEntryRoute,
  resolveHelpPageKeyFromLocation,
} from '@/lib/globalHelpToolsCatalog';

type PickerPayload = {
  pageKey: string;
  fieldKey: string;
  fieldLabel: string;
  routePath: string;
  selector: string;
};

const TARGET_INPUT_SELECTOR = 'input, select, textarea, [role="combobox"], [contenteditable="true"]';

const slugify = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

const attrEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const cssEscape = (value: string): string => {
  if (typeof window !== 'undefined' && (window as any).CSS?.escape) {
    return (window as any).CSS.escape(value);
  }
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
};

const canFocus = (element: HTMLElement): boolean =>
  ['input', 'select', 'textarea', 'button'].includes(element.tagName.toLowerCase()) ||
  element.getAttribute('tabindex') !== null ||
  element.getAttribute('contenteditable') === 'true';

const pulseTarget = (target: HTMLElement) => {
  const previousTransition = target.style.transition;
  const previousBoxShadow = target.style.boxShadow;
  target.style.transition = 'box-shadow 180ms ease';
  target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.65)';
  window.setTimeout(() => {
    target.style.boxShadow = previousBoxShadow;
    target.style.transition = previousTransition;
  }, 3000);
};

const focusAndRevealTarget = (target: HTMLElement) => {
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  if (canFocus(target)) {
    target.focus();
  }
  pulseTarget(target);
};

function inferFieldLabel(target: HTMLElement): string {
  const ariaLabel = target.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const id = target.getAttribute('id');
  if (id) {
    const labelEl = document.querySelector(`label[for="${cssEscape(id)}"]`);
    if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
  }
  const placeholder = target.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();
  const name = target.getAttribute('name');
  if (name) return name.trim();
  return target.tagName.toLowerCase();
}

function inferFieldKey(target: HTMLElement): string {
  const explicit =
    target.getAttribute('data-help-field-key') ||
    target.getAttribute('name') ||
    target.getAttribute('id');
  if (explicit) return slugify(explicit);
  return slugify(inferFieldLabel(target)) || 'field';
}

function selectorFromElement(target: HTMLElement): string {
  const id = target.getAttribute('id');
  if (id) return `#${cssEscape(id)}`;

  const name = target.getAttribute('name');
  if (name) return `${target.tagName.toLowerCase()}[name="${attrEscape(name)}"]`;

  const testId = target.getAttribute('data-testid');
  if (testId) return `[data-testid="${attrEscape(testId)}"]`;

  const parts: string[] = [];
  let current: HTMLElement | null = target;
  while (current && current !== document.body && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(current.parentElement?.children || []).filter(
      (sibling) => sibling.tagName === current.tagName
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function getPickerTabMessage(payload: PickerPayload): string {
  return `Selected ${payload.fieldLabel}`;
}

function HelpToolBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const returnTo = params.get(HELP_QUERY_RETURN);
  if (!returnTo) return null;

  return (
    <div className="fixed right-4 top-4 z-[75]">
      <Button
        size="sm"
        variant="outline"
        className="shadow-lg"
        onClick={() => navigate(returnTo)}
      >
        <MaterialIcon name="arrow_back" size="sm" className="mr-1" />
        Back to Help Tool
      </Button>
    </div>
  );
}

function HelpToolFieldPickerOverlay() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const pickerActive = params.get(HELP_PICKER_MODE) === '1';
  const pickerChannelId = params.get(HELP_PICKER_CHANNEL);
  const pageFromQuery = params.get(HELP_PICKER_PAGE);
  const [message, setMessage] = useState('Click any input, select, or textarea field to bind a help tip.');
  const highlightedTargetRef = useRef<HTMLElement | null>(null);

  const clearHighlight = useCallback(() => {
    const current = highlightedTargetRef.current;
    if (!current) return;
    current.style.outline = '';
    current.style.outlineOffset = '';
    highlightedTargetRef.current = null;
  }, []);

  const cleanupPickerParams = useCallback(() => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.delete(HELP_PICKER_MODE);
    nextParams.delete(HELP_PICKER_CHANNEL);
    nextParams.delete(HELP_PICKER_PAGE);
    const next = nextParams.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!pickerActive || !pickerChannelId) return;

    const channelName = `help-picker:${pickerChannelId}`;
    const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window
      ? new BroadcastChannel(channelName)
      : null;

    const sendSelection = (payload: PickerPayload) => {
      channel?.postMessage(payload);
      localStorage.setItem(`help-picker-result:${pickerChannelId}`, JSON.stringify({
        ...payload,
        timestamp: Date.now(),
      }));
      setMessage(getPickerTabMessage(payload));
      window.setTimeout(() => {
        try {
          window.close();
        } catch {
          cleanupPickerParams();
        }
      }, 160);
    };

    const handlePointerOver = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest(TARGET_INPUT_SELECTOR) as HTMLElement | null;
      if (!target) return;
      clearHighlight();
      highlightedTargetRef.current = target;
      target.style.outline = '2px solid rgba(59,130,246,0.9)';
      target.style.outlineOffset = '2px';
    };

    const handlePointerOut = () => {
      clearHighlight();
    };

    const handleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest(TARGET_INPUT_SELECTOR) as HTMLElement | null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const cleanedQuery = cleanHelpRuntimeQuery(location.search);
      const payload: PickerPayload = {
        pageKey: pageFromQuery || resolveHelpPageKeyFromLocation(location.pathname, location.search),
        fieldKey: inferFieldKey(target),
        fieldLabel: inferFieldLabel(target),
        routePath: `${location.pathname}${cleanedQuery ? `?${cleanedQuery}` : ''}`,
        selector: selectorFromElement(target),
      };
      sendSelection(payload);
    };

    document.addEventListener('mouseover', handlePointerOver, true);
    document.addEventListener('mouseout', handlePointerOut, true);
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('mouseover', handlePointerOver, true);
      document.removeEventListener('mouseout', handlePointerOut, true);
      document.removeEventListener('click', handleClick, true);
      clearHighlight();
      channel?.close();
    };
  }, [cleanupPickerParams, clearHighlight, location.pathname, location.search, pageFromQuery, pickerActive, pickerChannelId]);

  if (!pickerActive) return null;

  return (
    <div className="fixed left-1/2 top-4 z-[80] -translate-x-1/2 rounded-xl border bg-background/95 px-4 py-3 shadow-xl backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <MaterialIcon name="ads_click" size="sm" className="mt-0.5 text-primary" />
        <div className="space-y-1">
          <div className="text-sm font-medium">Help Field Picker</div>
          <div className="text-xs text-muted-foreground max-w-[420px]">{message}</div>
        </div>
        <Button size="sm" variant="outline" onClick={cleanupPickerParams}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function InjectedHelpIconsLayer() {
  const location = useLocation();
  const { data: tools = [] } = useGlobalHelpTools();
  const [openToolId, setOpenToolId] = useState<string | null>(null);
  const [mountedTargets, setMountedTargets] = useState<
    Array<{ tool: GlobalHelpTool; element: HTMLElement; top: number; left: number }>
  >([]);

  const activeInjected = useMemo(
    () =>
      tools.filter(
        (tool) =>
          tool.is_active &&
          tool.source_type === 'injected' &&
          !!tool.target_selector &&
          matchesEntryRoute(tool.route_path, location.pathname, location.search)
      ),
    [location.pathname, location.search, tools]
  );

  const recalc = useCallback(() => {
    const next: Array<{ tool: GlobalHelpTool; element: HTMLElement; top: number; left: number }> = [];
    activeInjected.forEach((tool) => {
      if (!tool.target_selector) return;
      const element = document.querySelector(tool.target_selector) as HTMLElement | null;
      if (!element || element.getClientRects().length === 0) return;
      const rect = element.getBoundingClientRect();
      next.push({
        tool,
        element,
        top: Math.max(12, rect.top + 6),
        left: Math.min(window.innerWidth - 28, rect.right + 8),
      });
    });
    setMountedTargets(next);
  }, [activeInjected]);

  useEffect(() => {
    recalc();
    const onScroll = () => recalc();
    const onResize = () => recalc();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [recalc]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetPage = params.get(HELP_QUERY_PAGE);
    const targetField = params.get(HELP_QUERY_FIELD);
    if (!targetPage || !targetField) return;

    const match = mountedTargets.find(
      ({ tool }) => tool.page_key === targetPage && tool.field_key === targetField
    );
    if (!match) return;

    focusAndRevealTarget(match.element);
    setOpenToolId(match.tool.id);
  }, [location.search, mountedTargets]);

  if (mountedTargets.length === 0) return null;

  return (
    <>
      {mountedTargets.map(({ tool, top, left }) => (
        <div
          key={tool.id}
          className="fixed z-[70]"
          style={{ top, left }}
          data-help-page-key={tool.page_key}
          data-help-field-key={tool.field_key}
        >
          <Popover open={openToolId === tool.id} onOpenChange={(open) => setOpenToolId(open ? tool.id : null)}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group inline-flex items-center justify-center -m-1 p-1 rounded-md transition touch-manipulation"
                aria-label="Help"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground transition group-hover:bg-muted/80">
                  <MaterialIcon name="info" size="sm" className="text-[12px]" />
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" className="max-w-[280px] p-3 text-xs leading-relaxed">
              <p>{tool.help_text}</p>
            </PopoverContent>
          </Popover>
        </div>
      ))}
    </>
  );
}

export function HelpToolRuntimeLayer() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const shouldEnableInjectedLayer = !params.get(HELP_QUERY_SELECTOR) || params.get(HELP_PICKER_MODE) !== '1';

  return (
    <>
      <HelpToolBackButton />
      <HelpToolFieldPickerOverlay />
      {shouldEnableInjectedLayer && <InjectedHelpIconsLayer />}
    </>
  );
}
