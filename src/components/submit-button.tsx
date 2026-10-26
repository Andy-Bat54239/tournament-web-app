"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** A submit button that disables itself while its form is sending. */
export function SubmitButton({
  children,
  className,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} name={name} value={value} disabled={disabled || pending}>
      {children}
    </button>
  );
}
