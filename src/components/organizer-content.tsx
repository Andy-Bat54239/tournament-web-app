import { connection } from "next/server";
import { logout } from "@/app/actions";
import { planFormat } from "@/domain/format";
import { openMatches } from "@/domain/knockout";
import { field, rosterCounts } from "@/domain/registration";
import { announcementText } from "@/domain/schedule";
import { readStore } from "@/server/instance";
import { getSessionUsername } from "@/server/session";
import { LoginCard } from "./login-card";
import {
  AdminsCard,
  AnnouncementCard,
  AuditCard,
  BracketCard,
  DeskCard,
  RefereeCard,
  ResultsCard,
  ScheduleCard,
} from "./organizer-cards";
import type { MatchOption } from "./results-form";

/** Organizer tools. Each card shows only if the viewer has that permission; the store enforces it again on every change. */
export async function OrganizerContent() {
  await connection();
  const now = new Date();
  const username = await getSessionUsername();
  if (!username) {
    return (
      <>
        <p className="note">Log in with Lichess to see the organizer tools.</p>
        <LoginCard next="/organizer" />
      </>
    );
  }

  const store = await readStore();
  const access = store.access(username);
  const can = (p: Parameters<typeof store.can>[1]) => store.can(username, p);
  const anyAccess = access && (access.superAdmin || access.grants.some((g) => can(g)));

  const who = (
    <form action={logout} className="who">
      <span>
        Logged in as {username}
        {access ? ` (${access.superAdmin ? "super admin" : (store.admins.find((a) => a.username === access.username)?.preset ?? "admin")})` : ""}.
      </span>
      <button type="submit" className="quiet">
        Log out
      </button>
    </form>
  );

  if (!anyAccess) {
    return (
      <>
        <div className="card">
          <p className="strong">No access.</p>
          <p className="note">
            {access
              ? "Admin access expires when the tournament ends."
              : "Organizer tools are for the super admin and the admins they have added."}
          </p>
        </div>
        {who}
      </>
    );
  }

  const { tournament } = store;
  const resolved = store.resolved();
  const players = field(store.registrations);
  const schedule = store.schedule();
  const names = tournament.qualifiers ?? [];
  const nameOf = (seed: number | null) => (seed === null ? "?" : (names[seed - 1]?.username ?? `Seed ${seed}`));

  const open = new Set(tournament.bracket && resolved ? openMatches(tournament.bracket, resolved).map((m) => m.id) : []);
  const matchOptions: MatchOption[] =
    tournament.bracket && resolved
      ? tournament.bracket.rounds
          .flat()
          .map((m) => resolved.matches[m.id])
          .filter((m) => m.hi !== null && !m.stale && (m.status !== "decided" || tournament.records[m.id]))
          .map((m) => ({
            id: m.id,
            open: open.has(m.id),
            label: `${m.title}: ${nameOf(m.hi)} v ${nameOf(m.lo)}${m.status === "decided" ? " (decided)" : ""}`,
          }))
          // Open matches first, since they are what the referee usually wants.
          .sort((a, b) => Number(b.open) - Number(a.open))
      : [];

  const { date, time } = store.startInputs();
  const desk = store.play.desk(now);

  return (
    <>
      {who}
      {can("settings") && <ScheduleCard date={date} time={time} />}
      {can("rounds") && (
        <BracketCard
          plan={planFormat(players.length)}
          players={players.length}
          built={tournament.qualifiers?.length ?? null}
        />
      )}
      {(can("result") || can("forfeit")) && (
        <RefereeCard items={desk.items} problems={desk.problems} canDecide={can("forfeit")} />
      )}
      {(can("result") || can("forfeit")) && (
        <ResultsCard options={matchOptions} canResult={can("result")} canForfeit={can("forfeit")} />
      )}
      {can("roster") && (
        <DeskCard counts={rosterCounts(store.registrations)} roster={store.registrations} />
      )}
      {can("announce") && (
        <AnnouncementCard
          text={tournament.announcement?.text ?? announcementText(schedule, false)}
          changed={tournament.announcement !== null}
          sentAt={tournament.announcement?.sentAt ?? null}
        />
      )}
      {can("admins") && <AdminsCard admins={store.admins} ended={tournament.status === "ended"} />}
      {can("audit") && <AuditCard entries={store.audit} />}
    </>
  );
}
