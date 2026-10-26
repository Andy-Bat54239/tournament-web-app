"use server";

import { refresh } from "next/cache";
import { field, type Result } from "@/domain/registration";
import type { GameOutcome } from "@/domain/match";
import type { FormState } from "@/lib/form-state";
import { getStore } from "@/server/instance";
import { getLichess } from "@/server/lichess";
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

async function asUser(run: (username: string) => Promise<FormState> | FormState): Promise<FormState> {
  const username = await getSessionUsername();
  return username ? run(username) : { error: "Log in with Lichess first." };
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
