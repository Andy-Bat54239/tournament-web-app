/** Placeholder shown in the static shell while live content streams in. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="card skeleton" aria-busy="true">
      <p className="note tight">{label}</p>
    </div>
  );
}
