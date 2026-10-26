/**
 * What a form action tells its form: an error to show, or a short confirmation.
 * `values` is what to put back in the form after an error. ActionForm fills it
 * in from the submission; an action only sets it to keep something else, such as
 * the match the referee had picked.
 */
export type FormState = { error?: string; ok?: string; values?: Record<string, string> } | null;

export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;
