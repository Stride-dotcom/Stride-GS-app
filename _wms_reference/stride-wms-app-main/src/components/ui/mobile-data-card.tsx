import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MobileDataCardProps extends React.HTMLAttributes<HTMLDivElement> {
  onClick?: () => void;
  selected?: boolean;
}

const MobileDataCard = React.forwardRef<HTMLDivElement, MobileDataCardProps>(
  ({ className, onClick, selected, children, ...props }, ref) => {
    return (
      <Card
        ref={ref}
        className={cn(
          "p-4 cursor-pointer active:scale-[0.98] transition-transform touch-manipulation",
          selected && "ring-2 ring-primary bg-muted/30",
          className
        )}
        onClick={onClick}
        {...props}
      >
        {children}
      </Card>
    );
  }
);
MobileDataCard.displayName = "MobileDataCard";

interface MobileDataCardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

const MobileDataCardHeader = React.forwardRef<HTMLDivElement, MobileDataCardHeaderProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex justify-between items-start gap-2", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MobileDataCardHeader.displayName = "MobileDataCardHeader";

interface MobileDataCardTitleProps extends React.HTMLAttributes<HTMLDivElement> {}

const MobileDataCardTitle = React.forwardRef<HTMLDivElement, MobileDataCardTitleProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("font-medium", className)} {...props}>
        {children}
      </div>
    );
  }
);
MobileDataCardTitle.displayName = "MobileDataCardTitle";

interface MobileDataCardDescriptionProps extends React.HTMLAttributes<HTMLDivElement> {}

const MobileDataCardDescription = React.forwardRef<HTMLDivElement, MobileDataCardDescriptionProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("text-sm text-muted-foreground line-clamp-1", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MobileDataCardDescription.displayName = "MobileDataCardDescription";

interface MobileDataCardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const MobileDataCardContent = React.forwardRef<HTMLDivElement, MobileDataCardContentProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("mt-2 text-sm", className)} {...props}>
        {children}
      </div>
    );
  }
);
MobileDataCardContent.displayName = "MobileDataCardContent";

interface MobileDataCardActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

const MobileDataCardActions = React.forwardRef<HTMLDivElement, MobileDataCardActionsProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("mt-3 flex justify-end gap-2", className)}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {children}
      </div>
    );
  }
);
MobileDataCardActions.displayName = "MobileDataCardActions";

export {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
  MobileDataCardActions,
};
