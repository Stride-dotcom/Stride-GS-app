import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Consistent "pill" formatting everywhere (padding/height), iOS-style chips.
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 min-h-6 text-xs font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-blue-500/20 text-white badge-gradient-default shadow-sm",
        secondary:
          "border-gray-300/40 text-gray-700 dark:text-gray-200 badge-gradient-secondary shadow-sm",
        destructive:
          "border-red-500/20 text-white badge-gradient-destructive shadow-sm",
        outline:
          "border-gray-300/70 dark:border-gray-600/70 bg-muted/40 text-foreground",
        success:
          "border-green-500/20 text-white badge-gradient-success shadow-sm",
        warning:
          "border-amber-500/20 text-white badge-gradient-warning shadow-sm",
        info: "border-blue-500/20 text-white badge-gradient-default shadow-sm",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(badgeVariants({ variant }), className)}
        style={style}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
