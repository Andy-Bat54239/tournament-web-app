"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { Result } from "@/domain/registration";
import type { GameOutcome } from "@/domain/match";
import type { FormState } from "@/lib/form-state";
import { parseSwissId, swissProgress } from "@/domain/swiss";
import { loginMode } from "@/server/auth-config";
import { readStore, updateStore } from "@/server/instance";
import { getLichess, getMockLichess } from "@/server/lichess";
import { ask } from "@/server/lichess/ask";
import type { SimulatedEvent } from "@/server/lichess/mock";
import { StoreBusy } from "@/server/provider";
import { clearSession, getSessionUsername, setSession } from "@/server/session";
import { standingsFor } from "@/server/swiss";

/**
 * Server Actions are public POST endpoints, so each one re-reads the session
 * and the store re-checks permissions. Nothing here trusts the page that
 * rendered the form.
 *
 * A change to the tournament goes through `updateStore`, which saves it to Postgres only if nobody else saved
 * first, and otherwise runs it again on the newer state. So the function given to it may run twice: it must
 * only change the store it is given, and anything else (calling Lichess for a profile, asking the browser to
 * refresh) is done outside it.
 */

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

function finish(result: Result<object>, message: string): FormState {
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: message };
}

async function asUser(run: (username: string) => Promise<FormState> | FormState): Promise<FormState> {
  const username = await getSessionUsername();
  if (!username) return { error: "Log in with Lichess first." };
  try {
    return await run(username);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof StoreBusy) return { error: "Many people are using the app at once. Try again in a moment." };
    console.error(error);
    return { error: "Something went wrong. Try again in a moment." };
  }
}

// Login. The mock stands in for Lichess OAuth until the API checks are done.

export async function mockLogin(_prev: FormState, data: FormData): Promise<FormState> {
  // Server Actions are public endpoints, so this must refuse even when the page shows the real login.
  if (loginMode() !== "mock") return { error: "Use Log in with Lichess." };
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
    const whatsapp = text(data, "whatsapp");
    const accepted = data.get("rules") === "on";
    const result = await updateStore((store) => store.signUp(profile, whatsapp, accepted, new Date()));
    return finish(result, "You’re in.");
  });
}

export async function joinTeam(): Promise<FormState> {
  return asUser(async (username) => finish(await updateStore((store) => store.joinTeam(username)), "Joined."));
}

export async function checkIn(): Promise<FormState> {
  return asUser(async (username) => finish(await updateStore((store) => store.checkIn(username, new Date())), "Checked in."));
}

export async function withdraw(): Promise<FormState> {
  return asUser(async (username) => finish(await updateStore((store) => store.withdraw(username, new Date())), "You’ve withdrawn."));
}

// Playing a match

export async function markReady(): Promise<FormState> {
  return asUser(async (username) => {
    const result = await updateStore(async (store): Promise<Result<{ linked: boolean }>> => {
      const now = new Date();
      const ready = store.play.markReady(username, now);
      if (!ready.ok) return ready;
      // Make the shared game link straight away, so "Play on Lichess" is there as soon as the player is ready.
      const link = await store.play.ensureLink(username, getLichess(), now);
      return { ok: true, linked: link.ok };
    });
    if (!result.ok) return { error: result.error };
    refresh();
    return result.linked ? { ok: "You’re ready." } : { ok: "You’re ready. The game link is not ready yet. Tap Get the game link." };
  });
}

export async function getGameLink(): Promise<FormState> {
  return asUser(async (username) => {
    const link = await updateStore((store) => store.play.ensureLink(username, getLichess(), new Date()));
    return finish(link, "Your game link is ready.");
  });
}

/** Called by the match screen every few seconds. Reads the game from Lichess and refreshes the screen. */
export async function syncMyMatch(): Promise<FormState> {
  return asUser(async (username) => {
    const read = await updateStore((store) => {
      const mine = store.play.openMatchOf(username);
      return mine ? store.play.syncGame(mine.match.id, getLichess(), new Date()) : null;
    });
    refresh();
    return read && !read.ok ? { error: read.error } : null;
  });
}

export async function claimWin(): Promise<FormState> {
  return asUser(async (username) =>
    finish(await updateStore((store) => store.play.claimWin(username, getLichess(), new Date())), "Your claim is with a referee."),
  );
}

export async function reportProblem(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (username) => {
    const body = text(data, "text");
    return finish(await updateStore((store) => store.play.reportProblem(username, body, new Date())), "Sent to the referees.");
  });
}

const SIMULATED: readonly string[] = ["join", "white", "black", "draw", "abort"];

/** Development only: acts as the two players on the mock Lichess, so every state can be reached by hand. */
export async function simulateGame(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (username) => {
    const mock = getMockLichess();
    const allowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_LOGIN === "true";
    if (!mock || !allowed) return { error: "The simulator is only for development." };
    const mine = (await readStore()).play.openMatchOf(username);
    const link = mine?.round.link;
    if (!mine || !link) return { error: "Get the game link first." };
    const event = text(data, "event");
    if (!SIMULATED.includes(event)) return { error: "Choose what happens." };
    const now = new Date();
    // The mock is not part of the saved state, so it is changed once here and not inside the update.
    if (!mock.simulate(link.id, event as SimulatedEvent, now)) return { error: "That cannot happen right now." };
    const read = await updateStore((store) => store.play.syncGame(mine.match.id, mock, now));
    return read.ok ? finish(read, "Done.") : { error: read.error };
  });
}

// Organizers

export async function changeSchedule(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (actor) => {
    const input = { date: text(data, "date"), time: text(data, "time"), reason: text(data, "reason") };
    return finish(
      await updateStore((store) => store.changeSchedule(actor, input, new Date())),
      "Saved. The announcement below is ready to send.",
    );
  });
}

export async function confirmAnnouncement(): Promise<FormState> {
  return asUser(async (actor) => finish(await updateStore((store) => store.markAnnouncementSent(actor, new Date())), "Logged."));
}

export async function removeNoShows(): Promise<FormState> {
  return asUser(async (actor) => {
    const result = await updateStore((store) => store.removeNoShows(actor, new Date()));
    return result.ok
      ? finish(result, `Removed ${result.removed.length}. Promoted ${result.promoted.length} from the waitlist.`)
      : { error: result.error };
  });
}

/** Chooses the Lichess Swiss the knockout is seeded from. Takes its link, or just the id. */
export async function setSwiss(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (actor) => {
    const id = parseSwissId(text(data, "swiss"));
    if (!id) return { error: "Paste the Swiss link from Lichess, like https://lichess.org/swiss/AbCdEfGh." };
    // Only an organizer may make Lichess calls from here.
    if (!(await readStore()).can(actor, "rounds")) return { error: "You don’t have access to that." };
    const found = await ask(() => getLichess().getSwiss(id));
    if (!found.ok) return { error: found.error };
    if (!found.value) return { error: "Lichess has no Swiss tournament with that id." };
    const swiss = found.value;
    const result = await updateStore((store) => store.setSwiss(actor, id, new Date()));
    return finish(result, `Using “${swiss.name}”. ${swissProgress(swiss)}.`);
  });
}

export async function buildBracket(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (actor) => {
    const raw = text(data, "qualifiers");
    const qualifiers = raw ? Number(raw) : undefined;
    if (qualifiers !== undefined && !Number.isInteger(qualifiers)) {
      return { error: "Qualifiers must be a whole number." };
    }
    // Lichess is asked first, outside the update, because that call can be slow. Only an organizer may ask it.
    const current = await readStore();
    if (!current.can(actor, "rounds")) return { error: "You don’t have access to that." };
    const found = await standingsFor(current, getLichess());
    if (!found.ok) return { error: found.error };
    const result = await updateStore((store) => store.buildBracket(actor, found.standings, { qualifiers }, new Date()));
    return result.ok ? finish(result, `Bracket built with ${result.qualifiers} qualifiers.`) : { error: result.error };
  });
}

export async function resetBracket(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (actor) => {
    const reason = text(data, "reason");
    return finish(await updateStore((store) => store.resetBracket(actor, reason, new Date())), "The bracket was reset.");
  });
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

async function applyMatchChange(actor: string, matchId: string, reason: string, change: string): Promise<FormState> {
  const now = new Date();
  const saved = "Saved and logged.";

  switch (change) {
    case "hi":
    case "lo":
    case "draw":
      return finish(await updateStore((store) => store.recordGame(actor, matchId, change as GameOutcome, reason, now)), saved);
    case "showed_hi":
      return finish(await updateStore((store) => store.recordNoShow(actor, matchId, { hi: true, lo: false }, reason, now)), saved);
    case "showed_lo":
      return finish(await updateStore((store) => store.recordNoShow(actor, matchId, { hi: false, lo: true }, reason, now)), saved);
    case "showed_none":
      return finish(await updateStore((store) => store.recordNoShow(actor, matchId, { hi: false, lo: false }, reason, now)), saved);
    case "undo":
      return finish(await updateStore((store) => store.undo(actor, matchId, reason, now)), "Undone and logged.");
    default:
      return { error: "Choose what happened." };
  }
}

export async function endTournament(): Promise<FormState> {
  return asUser(async (actor) => finish(await updateStore((store) => store.endTournament(actor, new Date())), "The tournament has ended."));
}

/**
 * A referee deals with a match from the desk. `do` is "confirm" or "reject" for a player's claim, or
 * "hi", "lo" or "none" for who turned up when nobody claimed.
 */
export async function settleMatch(_prev: FormState, data: FormData): Promise<FormState> {
  return asUser(async (actor) => {
    const matchId = text(data, "matchId");
    const now = new Date();
    const change = text(data, "do");
    switch (change) {
      case "confirm":
        return finish(await updateStore((store) => store.play.confirmClaim(actor, matchId, now)), "Saved and logged.");
      case "reject":
        return finish(await updateStore((store) => store.play.rejectClaim(actor, matchId, now)), "The players have 2 more minutes.");
      case "hi":
      case "lo":
      case "none":
        return finish(await updateStore((store) => store.play.settleNoShow(actor, matchId, change, now)), "Saved and logged.");
      default:
        return { error: "Choose what happened." };
    }
  });
}
