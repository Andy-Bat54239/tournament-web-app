import { connection } from "next/server";
import { formatWhen } from "@/domain/schedule";
import { getStore } from "@/server/instance";

/** "Tournament starts Sunday 1 November, 14:00 (East Africa Time)". Reads live state, so use inside <Suspense>. */
export async function StartsLine() {
  await connection();
  return <p>Tournament starts {formatWhen(new Date(getStore().tournament.startsAt))} (East Africa Time)</p>;
}

/** The "schedule changed" notice for the sign-up page, the player's screen and the live view. */
export async function ScheduleBanner() {
  await connection();
  const change = getStore().tournament.scheduleChange;
  if (!change) return null;
  return (
    <div className="banner" role="status">
      <b>Schedule changed.</b> New start: {formatWhen(new Date(change.to))}.
    </div>
  );
}
