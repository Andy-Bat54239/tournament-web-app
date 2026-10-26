"use client";

import { useActionState, useLayoutEffect, useRef } from "react";
import { updateMatch } from "@/app/actions";
import { SubmitButton } from "./submit-button";

export interface MatchOption {
  id: string;
  label: string;
  /** Ready or in progress, as opposed to decided. */
  open: boolean;
}

/**
 * Pick a match, give a reason, press what happened. The picked match is kept
 * after each save while it is still open, because the next step is usually the
 * same match's next game. Once it is decided the picker moves to the next open match.
 */
export function ResultsForm({
  options,
  canResult,
  canForfeit,
}: {
  options: MatchOption[];
  canResult: boolean;
  canForfeit: boolean;
}) {
  const [state, formAction] = useActionState(updateMatch, null);
  const kept = options.find((o) => o.id === state?.values?.matchId && o.open);
  const selected = (kept ?? options[0])?.id;

  // React resets the form after every action, and does not re-apply a changed
  // defaultValue to a <select>, so put the choice back once the reset is done.
  const picker = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (picker.current && selected) picker.current.value = selected;
  }, [selected, state]);

  return (
    <form action={formAction}>
      <label htmlFor="matchId">Match</label>
      <select ref={picker} id="matchId" name="matchId" defaultValue={selected}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <label htmlFor="result-reason">Reason (required)</label>
      <input id="result-reason" name="reason" required />
      {canResult && (
        <>
          <p className="ask">Result of the next game</p>
          <div className="btns">
            <SubmitButton name="do" value="hi">
              Higher seed won
            </SubmitButton>
            <SubmitButton name="do" value="draw" className="gold">
              Draw
            </SubmitButton>
            <SubmitButton name="do" value="lo">
              Lower seed won
            </SubmitButton>
          </div>
        </>
      )}
      {canForfeit && (
        <>
          <p className="ask">No-show: who turned up?</p>
          <div className="btns">
            <SubmitButton name="do" value="showed_hi">
              Higher seed only
            </SubmitButton>
            <SubmitButton name="do" value="showed_lo">
              Lower seed only
            </SubmitButton>
            <SubmitButton name="do" value="showed_none" className="gold">
              Neither
            </SubmitButton>
          </div>
        </>
      )}
      {canResult && (
        <div className="btns spaced">
          <SubmitButton name="do" value="undo" className="quiet">
            Undo the last change
          </SubmitButton>
        </div>
      )}
      <p className={state?.error ? "err" : "ok"} role="status" aria-live="polite">
        {state?.error ?? state?.ok}
      </p>
    </form>
  );
}
