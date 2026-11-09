"use client";

import { useActionState, useLayoutEffect, useRef, type ReactNode } from "react";
import type { FormAction, FormState } from "@/lib/form-state";

/** What was typed, except passwords: those are never kept, so they are not held in the page or sent again. */
function submitted(data: FormData, form: HTMLFormElement | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of data) {
    const field = form?.elements.namedItem(name);
    const secret = field instanceof HTMLInputElement && field.type === "password";
    if (typeof value === "string" && !name.startsWith("$") && !secret) values[name] = value;
  }
  return values;
}

/** Puts submitted values back into the form's text fields, selects and ticked checkboxes. */
function restore(form: HTMLFormElement, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement) {
      if (field.type === "checkbox" || field.type === "radio") field.checked = true;
      else field.value = value;
    } else if (field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      field.value = value;
    }
  }
}

/**
 * A form wired to a Server Action, with its error or confirmation shown
 * underneath. React clears a form after every action; when the action returns
 * an error, this puts back what the person had typed so they can fix it
 * instead of starting again (a wrong digit in a phone number, say). A password is the exception: it is cleared.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<FormState, FormData>(async (previous, data) => {
    const next = await action(previous, data);
    return next?.error ? { ...next, values: next.values ?? submitted(data, form.current) } : next;
  }, null);

  useLayoutEffect(() => {
    if (state?.error && state.values && form.current) restore(form.current, state.values);
  }, [state]);

  return (
    <form ref={form} action={formAction} className={className}>
      {children}
      <p className={state?.error ? "err" : "ok"} role="status" aria-live="polite">
        {state?.error ?? state?.ok}
      </p>
    </form>
  );
}
