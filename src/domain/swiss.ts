/** A Lichess Swiss id is eight letters and digits, as in https://lichess.org/swiss/AbCdEfGh. */
const SWISS_ID = /^[A-Za-z0-9]{8}$/;

/**
 * The Swiss id from whatever an organizer pastes: the page address, the address with more after it, or the
 * bare id. Null if it is none of those, for instance an address on another website.
 */
export function parseSwissId(input: string): string | null {
  const text = input.trim();
  if (SWISS_ID.test(text)) return text;

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.hostname !== "lichess.org" && url.hostname !== "www.lichess.org") return null;
  const [kind, id] = url.pathname.split("/").filter(Boolean);
  return kind === "swiss" && id && SWISS_ID.test(id) ? id : null;
}

/** Where a Swiss has got to, in words for the organizer. */
export function swissProgress(swiss: { status: "created" | "started" | "finished"; round: number; rounds: number; ongoing: number }): string {
  switch (swiss.status) {
    case "created":
      return "Not started yet";
    case "started":
      return `Round ${swiss.round} of ${swiss.rounds}` + (swiss.ongoing > 0 ? `, ${swiss.ongoing} game${swiss.ongoing === 1 ? "" : "s"} still being played` : "");
    case "finished":
      return `Finished after ${swiss.rounds} round${swiss.rounds === 1 ? "" : "s"}`;
  }
}

/**
 * How many rounds can still change the points. Once the Swiss is running the round being played counts, because
 * its games are not in the points yet. Between rounds that over-counts by one, which only makes the cut-off
 * more careful about calling anyone through or out.
 */
export function roundsLeft(swiss: { status: "created" | "started" | "finished"; round: number; rounds: number }): number {
  switch (swiss.status) {
    case "finished":
      return 0;
    case "created":
      return swiss.rounds;
    case "started":
      // A running Swiss always has the current round to go.
      return Math.min(Math.max(swiss.rounds - swiss.round + 1, 1), swiss.rounds);
  }
}
