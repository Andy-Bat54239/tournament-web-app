"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { field, type Result } from "@/domain/registration";
import type { GameOutcome } from "@/domain/match";
import type { FormState } from "@/lib/form-state";
import { getStore } from "@/server/instance";
import { getLichess, getMockLichess } from "@/server/lichess";
import type { SimulatedEvent } from "@/server/lichess/mock";
import { clearSession, getSessionUsername, setSession } from "@/server/session";

/**
 * Server Actions are public POST endpoints, so each one re-reads the session
 * and the store re-checks permissions. Nothing here trusts the page that
 * rendered the form.
 */

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function finish(result: Result<object>, message: string): FormState {
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: message };
}

/** Closes the game links the store has finished with. Best effort: failing here must never fail the action. */
async function closeLinks() {
  try {
    const ids = getStore().play.takeCancels();
    if (ids.length === 0) return;
    const lichess = getLichess();
    for (const id of ids) await lichess.cancelLink(id).catch(() => undefined);
  } catch {
    // Links expire on their own after 20 minutes.
  }
}

async function asUser(run: (username: string) => Promise<FormState> | FormState): Promise<FormState> {
  const username = await getSessionUsername();
  if (!username) return { error: "Log in with Lichess first." };
  try {
    const state = await run(username);
    await closeLinks();
    return state;
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    return { error: "Something went wrong. Try again in a moment." };
  }
}

// Login. The mock stands in for Lichess OAuth until the API checks are done.

export async function mockLogin(_prev: FormState, data: FormData): Promise<FormState> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_LOGIN !== "true") {
    return { error: "Log in with Lichess is not switched on yet." };
  }
  const profile = await getLichess().getProfile(text(data, "username"));
  if (!profile) return { error: "Enter a Lichess username: letters, numbers, _ or -." };
  await setSession(profile.username);
  refresh();
  return null;
}

export async function logout(): Promise<void> {
  await clearSession();
  refresh();
}

// Players

export async function signUp(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (username) => {
    const profile = await getLichess().getProfile(username);
    if (!profile) return { error: "We could not find your Lichess account." };
    const result = getStore().signUp(profile, text(data, "whatsapp"), data.get("rules") === "on", new Date());
    return finish(result, "You’re in.");
  });
}

export async function joinTeam(): Promise<FormState> {
  return asUser((username) => finish(getStore().joinTeam(username), "Joined."));
}

export async function checkIn(): Promise<FormState> {
  return asUser((username) => finish(getStore().checkIn(username, new Date()), "Checked in."));
}

export async function withdraw(): Promise<FormState> {
  return asUser((username) => finish(getStore().withdraw(username, new Date()), "You’ve withdrawn."));
}

// Playing a match

export async function markReady(): Promise<FormState> {
  return asUser(async (username) => {
    const store = getStore();
    const now = new Date();
    const ready = store.play.markReady(username, now);
    if (!ready.ok) return { error: ready.error };
    // Make the shared game link straight away, so "Play on Lichess" is there as soon as the player is ready.
    const link = await store.play.ensureLink(username, getLichess(), now);
    refresh();
    return link.ok ? { ok: "You’re ready." } : { ok: "You’re ready. The game link is not ready yet. Tap Get the game link." };
  });
}

export async function getGameLink(): Promise<FormState> {
  return asUser(async (username) => {
    const link = await getStore().play.ensureLink(username, getLichess(), new Date());
    return finish(link, "Your game link is ready.");
  });
}

/** Called by the match screen every few seconds. Reads the game from Lichess and refreshes the screen. */
export async function syncMyMatch(): Promise<FormState> {
  return asUser(async (username) => {
    const store = getStore();
    const mine = store.play.openMatchOf(username);
    const read = mine ? await store.play.syncGame(mine.match.id, getLichess(), new Date()) : null;
    refresh();
    return read && !read.ok ? { error: read.error } : null;
  });
}

export async function claimWin(): Promise<FormState> {
  return asUser(async (username) =>
    finish(await getStore().play.claimWin(username, getLichess(), new Date()), "Your claim is with a referee."),
  );
}

export async function reportProblem(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser((username) => finish(getStore().play.reportProblem(username, text(data, "text"), new Date()), "Sent to the referees."));
}

const SIMULATED: readonly string[] = ["join", "white", "black", "draw", "abort"];

/** Development only: acts as the two players on the mock Lichess, so every state can be reached by hand. */
export async function simulateGame(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (username) => {
    const mock = getMockLichess();
    const allowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_LOGIN === "true";
    if (!mock || !allowed) return { error: "The simulator is only for development." };
    const store = getStore();
    const mine = store.play.openMatchOf(username);
    const link = mine?.round.link;
    if (!mine || !link) return { error: "Get the game link first." };
    const event = text(data, "event");
    if (!SIMULATED.includes(event)) return { error: "Choose what happens." };
    const now = new Date();
    if (!mock.simulate(link.id, event as SimulatedEvent, now)) return { error: "That cannot happen right now." };
    const read = await store.play.syncGame(mine.match.id, mock, now);
    return read.ok ? finish(read, "Done.") : { error: read.error };
  });
}

// Organizers

export async function changeSchedule(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser((actor) =>
    finish(
      getStore().changeSchedule(
        actor,
        { date: text(data, "date"), time: text(data, "time"), reason: text(data, "reason") },
        new Date(),
      ),
      "Saved. The announcement below is ready to send.",
    ),
  );
}

export async function confirmAnnouncement(): Promise<FormState> {
  return asUser((actor) => finish(getStore().markAnnouncementSent(actor, new Date()), "Logged."));
}

export async function removeNoShows(): Promise<FormState> {
  return asUser((actor) => {
    const result = getStore().removeNoShows(actor, new Date());
    return result.ok
      ? finish(result, `Removed ${result.removed.length}. Promoted ${result.promoted.length} from the waitlist.`)
      : { error: result.error };
  });
}

export async function buildBracket(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (actor) => {
    const raw = text(data, "qualifiers");
    const qualifiers = raw ? Number(raw) : undefined;
    if (qualifiers !== undefined && !Number.isInteger(qualifiers)) {
      return { error: "Qualifiers must be a whole number." };
    }
    const store = getStore();
    const standings = await getLichess().getSwissStandings({
      swissId: null,
      entrants: field(store.registrations).map((r) => r.username),
    });
    const result = store.buildBracket(actor, standings, { qualifiers }, new Date());
    return result.ok ? finish(result, `Bracket built with ${result.qualifiers} qualifiers.`) : { error: result.error };
  });
}

export async function resetBracket(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser((actor) =>
    finish(getStore().resetBracket(actor, text(data, "reason"), new Date()), "The bracket was reset."),
  );
}

/**
 * The result form: pick a match, give a reason, then press one button.
 * `do` is "hi", "lo" or "draw" (a game result), "showed_hi", "showed_lo" or
 * "showed_none" (a no-show), or "undo". The store checks the right permission
 * for each.
 */
export async function updateMatch(_prev: FormState, data: FormData): Promise<FormState> {
  const matchId = text(data, "matchId");
  const state = await asUser((actor) => applyMatchChange(actor, matchId, text(data, "reason"), text(data, "do")));
  // Keep the picked match: the next step is usually the same match's next game.
  return { ...state, values: { matchId } };
}

function applyMatchChange(actor: string, matchId: string, reason: string, change: string): FormState {
  const store = getStore();
  const now = new Date();
  const saved = "Saved and logged.";

  switch (change) {
    case "hi":
    case "lo":
    case "draw":
      return finish(store.recordGame(actor, matchId, change as GameOutcome, reason, now), saved);
    case "showed_hi":
      return finish(store.recordNoShow(actor, matchId, { hi: true, lo: false }, reason, now), saved);
    case "showed_lo":
      return finish(store.recordNoShow(actor, matchId, { hi: false, lo: true }, reason, now), saved);
    case "showed_none":
      return finish(store.recordNoShow(actor, matchId, { hi: false, lo: false }, reason, now), saved);
    case "undo":
      return finish(store.undo(actor, matchId, reason, now), "Undone and logged.");
    default:
      return { error: "Choose what happened." };
  }
}

export async function endTournament(): Promise<FormState> {
  return asUser((actor) => finish(getStore().endTournament(actor, new Date()), "The tournament has ended."));
}

/**
 * A referee deals with a match from the desk. `do` is "confirm" or "reject" for a player's claim, or
 * "hi", "lo" or "none" for who turned up when nobody claimed.
 */
export async function settleMatch(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser((actor) => {
    const store = getStore();
    const matchId = text(data, "matchId");
    const now = new Date();
    switch (text(data, "do")) {
      case "confirm":
        return finish(store.play.confirmClaim(actor, matchId, now), "Saved and logged.");
      case "reject":
        return finish(store.play.rejectClaim(actor, matchId, now), "The players have 2 more minutes.");
      case "hi":
      case "lo":
      case "none":
        return finish(store.play.settleNoShow(actor, matchId, text(data, "do") as "hi" | "lo" | "none", now), "Saved and logged.");
      default:
        return { error: "Choose what happened." };
    }
  });
}
