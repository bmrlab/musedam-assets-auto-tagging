import * as React from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  placeholderContent?: React.ReactNode;
  containerClassName?: string;
}

function Textarea({ className, placeholderContent, containerClassName, ...props }: TextareaProps) {
  const [isFocused, setIsFocused] = React.useState(false);
  const [hasValue, setHasValue] = React.useState(false);
  React.useEffect(() => {
    if (props.value) {
      setHasValue(true);
    }
  }, [props.value]);

  const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(true);
    props.onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(false);
    props.onBlur?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setHasValue(e.target.value.length > 0);
    props.onChange?.(e);
  };

  const showPlaceholder = !hasValue && placeholderContent;

  return (
    <div className={cn("relative", containerClassName)}>
      <textarea
        data-slot="textarea"
        className={cn(
          "placeholder:text-basic-5 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        onInput={(e) => {
          const value = (e.target as HTMLTextAreaElement).value;
          if (value.length === 0 && hasValue) {
            setHasValue(false);
          }
          if (value.length > 0 && !hasValue) {
            setHasValue(true);
          }
        }}
        {...props}
      />
      {showPlaceholder && (
        <div className="absolute inset-0 pointer-events-none px-3 py-2 text-basic-5 text-sm">
          {placeholderContent}
        </div>
      )}
    </div>
  );
}

export { Textarea };
