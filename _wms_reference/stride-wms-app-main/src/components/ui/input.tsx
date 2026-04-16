import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentProps<"input"> {
  uppercase?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, uppercase, onChange, autoCapitalize, ...props }, ref) => {
    const shouldUppercaseByDefault =
      // Uppercasing URLs/emails/passwords can break semantics (and file inputs are special).
      type !== "password" && type !== "url" && type !== "email" && type !== "file" && type !== "number";
    const shouldUppercase = uppercase !== undefined ? uppercase : shouldUppercaseByDefault;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (shouldUppercase) {
        const next = e.target.value.toUpperCase();
        if (next !== e.target.value) {
          e.target.value = next;
        }
      }
      onChange?.(e);
    };

    // Default to ALL CAPS keyboard for short text inputs (mostly mobile-only behavior).
    // Long text fields should use <Textarea> (which defaults to autoCapitalize="none").
    const resolvedAutoCapitalize =
      autoCapitalize ??
      (type === undefined || type === "text" || type === "search" || type === "tel"
        ? "characters"
        : "none");

    return (
      <input
        type={type}
        autoCapitalize={resolvedAutoCapitalize}
        className={cn(
          "flex h-10 w-full rounded-2xl border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm transition-colors duration-150",
          shouldUppercase && "uppercase",
          className,
        )}
        ref={ref}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };