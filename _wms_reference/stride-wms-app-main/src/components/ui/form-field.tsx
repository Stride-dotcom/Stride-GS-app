import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * Mobile-first form field component
 * - Stacks label + input on small screens (<640px)
 * - Ensures font-size >= 16px (prevents iOS zoom)
 * - min-height >= 44px for touch targets
 * - Supports input, textarea (auto-grow), number, date
 * - Handles validation errors inline
 */

export type FormFieldType = "text" | "textarea" | "number" | "date" | "email" | "tel" | "password" | "url";

export interface FormFieldProps {
  /** Field label */
  label: string;
  /** Field name/id */
  name: string;
  /** Input type */
  type?: FormFieldType;
  /** Current value */
  value: string | number;
  /** Change handler */
  onChange: (value: string) => void;
  /** Blur handler */
  onBlur?: () => void;
  /** Placeholder text */
  placeholder?: string;
  /** Error message */
  error?: string;
  /** Help text below field */
  helpText?: string;
  /** Required field */
  required?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Read-only state */
  readOnly?: boolean;
  /** Auto-focus on mount */
  autoFocus?: boolean;
  /** For number inputs - min value */
  min?: number;
  /** For number inputs - max value */
  max?: number;
  /** For number inputs - step */
  step?: number;
  /** For textarea - min rows */
  minRows?: number;
  /** For textarea - max rows before scroll */
  maxRows?: number;
  /** Force uppercase */
  uppercase?: boolean;
  /** Additional className for wrapper */
  className?: string;
  /** Additional className for input */
  inputClassName?: string;
  /** Label position - horizontal on large screens, always vertical on mobile */
  labelPosition?: "top" | "horizontal";
}

// Auto-growing textarea hook
function useAutoGrow(
  value: string | number,
  minRows: number = 2,
  maxRows: number = 8
) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to get proper scrollHeight
    textarea.style.height = "auto";
    
    // Calculate line height (default to 24px if not available)
    const lineHeight = parseInt(getComputedStyle(textarea).lineHeight) || 24;
    const paddingY = 16; // py-2 = 8px * 2
    
    const minHeight = lineHeight * minRows + paddingY;
    const maxHeight = lineHeight * maxRows + paddingY;
    
    // Set new height within bounds
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [value, minRows, maxRows]);

  return textareaRef;
}

export const FormField = React.forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  FormFieldProps
>(
  (
    {
      label,
      name,
      type = "text",
      value,
      onChange,
      onBlur,
      placeholder,
      error,
      helpText,
      required = false,
      disabled = false,
      readOnly = false,
      autoFocus = false,
      min,
      max,
      step,
      minRows = 2,
      maxRows = 8,
      uppercase,
      className,
      inputClassName,
      labelPosition = "top",
    },
    ref
  ) => {
    const inputId = React.useId();
    const errorId = `${inputId}-error`;
    const helpId = `${inputId}-help`;

    const textareaRef = useAutoGrow(value, minRows, maxRows);

    // "All caps" for non-long-text fields. Explicit `uppercase` prop overrides.
    // Keep URLs/emails/passwords as typed (case can matter).
    const shouldUppercase =
      type !== "textarea" &&
      (uppercase !== undefined ? uppercase : type !== "email" && type !== "password" && type !== "url");

    const handleChange = (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      let newValue = e.target.value;
      if (shouldUppercase) {
        newValue = newValue.toUpperCase();
      }
      onChange(newValue);
    };

    // Common input classes - mobile-first with 16px font (prevents iOS zoom)
    const baseInputClasses = cn(
      // Mobile-first: full width, proper touch target
      "w-full min-h-[44px] px-3 py-2",
      // Font size >= 16px prevents iOS zoom on focus
      "text-base",
      // Standard styling
      "rounded-md border bg-background text-foreground",
      "placeholder:text-muted-foreground",
      // Focus states
      "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
      // Error state
      error
        ? "border-destructive focus:ring-destructive"
        : "border-input",
      // Disabled/readonly states
      disabled && "cursor-not-allowed opacity-50",
      readOnly && "cursor-default bg-muted",
      // Uppercase if requested
      shouldUppercase && "uppercase",
      // Transition
      "transition-colors duration-150",
      inputClassName
    );

    const renderInput = () => {
      if (type === "textarea") {
        return (
          <textarea
            ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
            id={inputId}
            name={name}
            value={value}
            onChange={handleChange}
            onBlur={onBlur}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            autoFocus={autoFocus}
            required={required}
            autoCapitalize="none"
            aria-invalid={!!error}
            aria-describedby={cn(error && errorId, helpText && helpId)}
            className={cn(baseInputClasses, "resize-none overflow-y-auto")}
            style={{ minHeight: `${44 + (minRows - 1) * 24}px` }}
          />
        );
      }

      return (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          id={inputId}
          name={name}
          type={type}
          value={value}
          onChange={handleChange}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          required={required}
          autoCapitalize={type === "text" ? "characters" : "none"}
          min={min}
          max={max}
          step={step}
          aria-invalid={!!error}
          aria-describedby={cn(error && errorId, helpText && helpId)}
          className={baseInputClasses}
        />
      );
    };

    return (
      <div
        className={cn(
          "space-y-1.5",
          // Horizontal layout on larger screens if requested
          labelPosition === "horizontal" &&
            "sm:grid sm:grid-cols-[160px_1fr] sm:items-start sm:gap-4 sm:space-y-0",
          className
        )}
      >
        <Label
          htmlFor={inputId}
          className={cn(
            "text-sm font-medium leading-none",
            // Align label to top of input in horizontal mode
            labelPosition === "horizontal" && "sm:pt-3",
            error && "text-destructive"
          )}
        >
          {label}
          {required && (
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          )}
        </Label>

        <div className="space-y-1.5">
          {renderInput()}

          {/* Help text */}
          {helpText && !error && (
            <p id={helpId} className="text-xs text-muted-foreground">
              {helpText}
            </p>
          )}

          {/* Error message */}
          {error && (
            <p id={errorId} className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }
);

FormField.displayName = "FormField";

export { FormField as default };
