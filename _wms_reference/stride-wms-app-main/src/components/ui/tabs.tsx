import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

type TabsListProps = React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  /**
   * When true, renders a horizontally scrollable "pill bar" style tabs list
   * (useful on mobile when there are many tabs).
   *
   * NOTE: Auto-scrolling the active tab into view is handled by the caller.
   */
  scrollable?: boolean;
};

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, scrollable, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Default safeguard: never force horizontal page overflow.
      // Callers can opt-in to a more explicit "scrollable tab bar" layout via `scrollable`.
      "inline-flex h-10 max-w-full items-center justify-center overflow-x-auto rounded-xl bg-muted p-1 text-muted-foreground scrollbar-thin",
      scrollable &&
        "flex w-full overflow-x-auto overflow-y-hidden whitespace-nowrap justify-start scrollbar-hide scroll-momentum",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

/**
 * ScrollableTabsList - Apple-style horizontally scrollable tabs for mobile.
 * On mobile, the tab bar scrolls horizontally with momentum; on desktop, it wraps normally.
 * Automatically scrolls to keep the active tab visible.
 */
const ScrollableTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { activeValue?: string }
>(({ className, children, activeValue, ...props }, ref) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const activeTab = container.querySelector('[data-state="active"]') as HTMLElement | null;
    if (activeTab) {
      const containerRect = container.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      const scrollLeft = container.scrollLeft + (tabRect.left - containerRect.left) - (containerRect.width / 2) + (tabRect.width / 2);
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [activeValue]);

  return (
    <div
      ref={scrollRef}
      className="w-full overflow-x-auto scrollbar-hide -webkit-overflow-scrolling-touch"
      style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "inline-flex h-10 items-center rounded-xl bg-muted p-1 text-muted-foreground w-max min-w-full",
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    </div>
  );
});
ScrollableTabsList.displayName = "ScrollableTabsList";

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, ScrollableTabsList, TabsTrigger, TabsContent };
