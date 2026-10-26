import {
  buildBracket,
  changeSchedule,
  confirmAnnouncement,
  endTournament,
  removeNoShows,
  resetBracket,
  settleMatch,
} from "@/app/actions";
import type { FormatPlan } from "@/domain/format";
import { PERMISSION_LABELS } from "@/domain/permissions";
import { formatUgandaPhone } from "@/domain/phone";
import type { Registration, RosterCounts } from "@/domain/registration";
import { formatWhen } from "@/domain/schedule";
import type { DeskItem, DeskProblem } from "@/server/play";
import type { AdminRecord, AuditEntry } from "@/server/store";
import { ActionForm } from "./action-form";
import { ResultsForm, type MatchOption } from "./results-form";
import { SubmitButton } from "./submit-button";

export function ScheduleCard({ date, time }: { date: string; time: string }) {
  return (
    <div className="card">
      <h3>Tournament schedule</h3>
      <ActionForm action={changeSchedule}>
        <label htmlFor="date">Date</label>
        <input id="date" name="date" type="date" defaultValue={date} required />
        <label htmlFor="time">Start time, East Africa Time</label>
        <input id="time" name="time" type="time" defaultValue={time} required />
        <label htmlFor="schedule-reason">Reason, if you are changing it</label>
        <input id="schedule-reason" name="reason" placeholder="Why is the time changing?" />
        <SubmitButton className="wide">Save date and time</SubmitButton>
      </ActionForm>
      <p className="note">Sign-up close, check-in and round times follow the start time.</p>
    </div>
  );
}

export function BracketCard({
  plan,
  players,
  built,
}: {
  plan: FormatPlan | null;
  players: number;
  built: number | null;
}) {
  if (built !== null) {
    return (
      <div className="card">
        <h3>Bracket</h3>
        <p>Built with {built} qualifiers.</p>
        <ActionForm action={resetBracket}>
          <label htmlFor="reset-reason">Reason for starting again</label>
          <input id="reset-reason" name="reason" required />
          <SubmitButton className="wide quiet">Reset the bracket and clear every result</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Bracket</h3>
      <p>
        {plan === null
          ? `${players} registered. At least 2 players are needed.`
          : plan.kind === "knockout_only"
            ? `${players} registered. That is a straight knockout of ${plan.knockoutRounds} rounds, seeded by rating.`
            : `${players} registered: a ${plan.swissRounds}-round Swiss, then the top ${plan.qualifiers} play a ${plan.knockoutRounds}-round knockout.`}
      </p>
      {plan !== null && (
        <ActionForm action={buildBracket}>
          <label htmlFor="qualifiers">Qualifiers (leave blank for the standard cut-off)</label>
          <input id="qualifiers" name="qualifiers" type="number" inputMode="numeric" min={2} max={32} />
          <SubmitButton className="wide">
            {plan.kind === "knockout_only" ? "Build the bracket" : "Build the bracket from the Swiss standings"}
          </SubmitButton>
        </ActionForm>
      )}
      <p className="note">
        {/* The mock Swiss stands in for Lichess until the API checks are done. */}
        Standings are simulated for now. Lichess is not connected yet.
      </p>
    </div>
  );
}

export function ResultsCard({
  options,
  canResult,
  canForfeit,
}: {
  options: MatchOption[];
  canResult: boolean;
  canForfeit: boolean;
}) {
  return (
    <div className="card">
      <h3>Set a result by hand</h3>
      {options.length === 0 ? (
        <p className="note tight">No open matches.</p>
      ) : (
        <ResultsForm options={options} canResult={canResult} canForfeit={canForfeit} />
      )}
    </div>
  );
}

/** Claims, matches past their waiting time, odd Lichess results, repeated aborts, and reported problems. */
export function RefereeCard({
  items,
  problems,
  canDecide,
}: {
  items: readonly DeskItem[];
  problems: readonly DeskProblem[];
  canDecide: boolean;
}) {
  return (
    <div className="card">
      <h3>Matches that need a referee</h3>
      {items.length === 0 ? (
        <p className="note tight">Nothing needs a referee right now.</p>
      ) : (
        items.map((item) => (
          <div key={item.matchId} className="desk-item">
            <p className="strong">
              {item.title}, game {item.game}
            </p>
            <p>
              {item.hi.name} ({item.hi.ready ? "ready" : "not ready"}) v {item.lo.name} ({item.lo.ready ? "ready" : "not ready"})
            </p>
            <ul className="log bare">
              {item.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {canDecide && (item.claim || (item.windowOver && !item.joined)) && (
              <ActionForm action={settleMatch}>
                <input type="hidden" name="matchId" value={item.matchId} />
                <div className="btns">
                  {item.claim ? (
                    <>
                      <SubmitButton name="do" value="confirm">
                        Give the win to {item.claim.byName}
                      </SubmitButton>
                      <SubmitButton name="do" value="reject" className="quiet">
                        Turn the claim down
                      </SubmitButton>
                    </>
                  ) : (
                    <>
                      <SubmitButton name="do" value="hi">
                        Only {item.hi.name} was here
                      </SubmitButton>
                      <SubmitButton name="do" value="lo">
                        Only {item.lo.name} was here
                      </SubmitButton>
                      <SubmitButton name="do" value="none" className="gold">
                        Neither was here
                      </SubmitButton>
                    </>
                  )}
                </div>
              </ActionForm>
            )}
          </div>
        ))
      )}

      <h3 className="spaced-heading">Problems reported</h3>
      {problems.length === 0 ? (
        <p className="note tight">None yet.</p>
      ) : (
        <ul className="log bare">
          {problems.slice(0, 10).map((problem) => (
            <li key={`${problem.matchId}-${problem.at}-${problem.by}`}>
              <span className="when">{formatWhen(new Date(problem.at))}</span> · <b>{problem.by}</b> in {problem.title}
              {problem.game === null ? "" : `, game ${problem.game}`}
              {problem.late ? " (reported late)" : ""}: {problem.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DeskCard({
  counts,
  roster,
}: {
  counts: RosterCounts;
  roster: readonly Registration[];
}) {
  return (
    <div className="card">
      <h3>Check-in desk</h3>
      <p>
        Checked in: {counts.checkedIn}. Not checked in: {counts.notCheckedIn}. Waitlist: {counts.waitlist}.
      </p>
      <ActionForm action={removeNoShows}>
        <SubmitButton className="wide" disabled={counts.notCheckedIn === 0}>
          Remove no-shows and promote the waitlist
        </SubmitButton>
      </ActionForm>
      <details>
        <summary>Roster with WhatsApp numbers</summary>
        <p className="note">Only organizers see these numbers.</p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>WhatsApp</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((r) => (
                <tr key={r.username}>
                  <td>{r.username}</td>
                  <td>{formatUgandaPhone(r.whatsapp)}</td>
                  <td>{r.status === "registered" ? (r.checkedIn ? "Checked in" : "Not in") : r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function AnnouncementCard({
  text,
  changed,
  sentAt,
}: {
  text: string;
  changed: boolean;
  sentAt: string | null;
}) {
  return (
    <div className="card">
      <h3>Community chat announcement</h3>
      <div className="msg">{text}</div>
      <div className="btns spaced">
        <a className="button" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </a>
      </div>
      <p className="note">WhatsApp opens with this text ready. You pick the group and send it.</p>
      {changed &&
        (sentAt ? (
          <p className="ok">Sent to the community chat ({formatWhen(new Date(sentAt))}).</p>
        ) : (
          <ActionForm action={confirmAnnouncement}>
            <SubmitButton className="wide gold">I sent it to the community chat</SubmitButton>
          </ActionForm>
        ))}
    </div>
  );
}

export function AuditCard({ entries }: { entries: readonly AuditEntry[] }) {
  return (
    <div className="card">
      <h3>Audit log</h3>
      {entries.length === 0 ? (
        <p className="note tight">No changes yet.</p>
      ) : (
        <ul className="log bare">
          {[...entries]
            .reverse()
            .slice(0, 20)
            .map((e, i) => (
              <li key={i}>
                <span className="when">{formatWhen(new Date(e.at))}</span> · {e.actor}: {e.action}
                {e.reason && <em> Reason: {e.reason}</em>}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function AdminsCard({ admins, ended }: { admins: readonly AdminRecord[]; ended: boolean }) {
  return (
    <div className="card">
      <h3>Admins</h3>
      <ul className="log bare">
        {admins.map((a) => (
          <li key={a.username}>
            <b>{a.username}</b> ({a.preset ?? "custom"}): {a.grants.map((g) => PERMISSION_LABELS[g].toLowerCase()).join(", ")}
          </li>
        ))}
      </ul>
      <p className="note">
        Admin access expires when the tournament ends. Adding admins and changing their ticks comes next.
      </p>
      {ended ? (
        <p className="ok">The tournament has ended. Admin access has expired.</p>
      ) : (
        <ActionForm action={endTournament}>
          <SubmitButton className="wide quiet">End the tournament (admins lose access)</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
