import {
  addAdmin,
  buildBracket,
  changeSchedule,
  confirmAnnouncement,
  endTournament,
  removeNoShows,
  resetBracket,
  setSwiss,
  settleMatch,
  startKnockout,
  simulateSwiss,
  updateAdmin,
} from "@/app/actions";
import type { FormatPlan } from "@/domain/format";
import { STAGES, countStages, roundUpdateText, type BoardStage, type RoundBoard } from "@/domain/round-board";
import { GRANTABLE, PERMISSION_LABELS } from "@/domain/permissions";
import { formatUgandaPhone } from "@/domain/phone";
import type { Registration, RosterCounts } from "@/domain/registration";
import { formatWhen } from "@/domain/schedule";
import type { DeskItem, DeskProblem } from "@/server/play";
import type { AdminRecord, AuditEntry } from "@/server/store";
import { ActionForm } from "./action-form";
import { AutoSync } from "./auto-sync";
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

/** The Swiss the knockout is seeded from, as Lichess reports it. `problem` is set when Lichess could not be asked. */
export interface SwissView {
  id: string;
  name: string | null;
  progress: string | null;
  problem: string | null;
}

/** Stands in for the Swiss being played on Lichess, so the cut-off and the bubble can be seen at every stage. */
export function SwissSimulator() {
  return (
    <div className="card dev">
      <h3>Development only: move the simulated Swiss along</h3>
      <ActionForm action={simulateSwiss}>
        <div className="btns">
          <SubmitButton name="stage" value="0" className="quiet">
            Not started
          </SubmitButton>
          <SubmitButton name="stage" value="2">
            Round 2
          </SubmitButton>
          <SubmitButton name="stage" value="4">
            Round 4
          </SubmitButton>
          <SubmitButton name="stage" value="6">
            Last round
          </SubmitButton>
          <SubmitButton name="stage" value="finished">
            Finished
          </SubmitButton>
        </div>
      </ActionForm>
      <p className="note">This stands in for the Swiss on Lichess with the mock. It does not exist in the real app.</p>
    </div>
  );
}

export function BracketCard({
  plan,
  players,
  built,
  swiss,
  live,
}: {
  plan: FormatPlan | null;
  players: number;
  built: number | null;
  swiss: SwissView | null;
  /** Whether Lichess is the real one. If not, the Swiss is simulated and none needs choosing. */
  live: boolean;
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
      {plan?.kind === "swiss_knockout" && (
        <>
          <ActionForm action={setSwiss}>
            <label htmlFor="swiss">Lichess Swiss tournament{live ? "" : " (optional while Lichess is simulated)"}</label>
            <input
              id="swiss"
              name="swiss"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://lichess.org/swiss/AbCdEfGh"
              defaultValue={swiss ? `https://lichess.org/swiss/${swiss.id}` : ""}
              required
            />
            <SubmitButton className="wide quiet">Use this Swiss</SubmitButton>
          </ActionForm>
          <p className="note">
            {swiss
              ? swiss.problem
                ? `Swiss ${swiss.id}: ${swiss.problem}`
                : `${swiss.name}: ${swiss.progress}.`
              : live
                ? "No Swiss chosen yet. Create it on Lichess in the Castle Connect team, then paste its link here."
                : "No Swiss chosen. The standings are invented while Lichess is simulated."}
          </p>
        </>
      )}
      {plan !== null && (
        <ActionForm action={buildBracket}>
          <label htmlFor="qualifiers">Qualifiers (leave blank for the standard cut-off)</label>
          <input id="qualifiers" name="qualifiers" type="number" inputMode="numeric" min={2} max={32} />
          <label className="ck">
            <input type="checkbox" name="hold" />
            <span>
              Hold the knockout. Players see who they play, but no waiting time runs until you press Start. Use this
              when the knockout is on another day.
            </span>
          </label>
          <SubmitButton className="wide">
            {plan.kind === "knockout_only" ? "Build the bracket" : "Build the bracket from the Swiss standings"}
          </SubmitButton>
        </ActionForm>
      )}
      {!live && <p className="note">Lichess is simulated here, so the standings are invented.</p>}
    </div>
  );
}

const STAGE_LABEL: Record<BoardStage, string> = {
  flagged: "Needs a referee",
  playing: "Playing",
  ready: "Waiting for players",
  held: "On hold",
  waiting: "Waiting for earlier matches",
  decided: "Done",
};

/** Every match of the knockout and where it stands, with the button that starts a held knockout. Refreshes itself. */
export function RoundsCard({ board, canStart }: { board: RoundBoard; canStart: boolean }) {
  const all = board.rounds.flatMap((r) => r.matches);
  const totals = countStages(all);
  const update = roundUpdateText(board);
  return (
    <div className="card">
      <h3>Round control</h3>
      {board.held && (
        <>
          <p className="strong">The knockout is on hold.</p>
          <p className="note">
            Players can see who they play, but no waiting time is running and nobody can start a game.
          </p>
          {canStart && (
            <ActionForm action={startKnockout}>
              <SubmitButton className="wide gold">Start the knockout</SubmitButton>
            </ActionForm>
          )}
        </>
      )}
      <p className="chips">
        {STAGES.filter((stage) => totals[stage] > 0).map((stage) => (
          <span key={stage} className={`chip ${stage}`}>
            {STAGE_LABEL[stage]}: {totals[stage]}
          </span>
        ))}
      </p>
      {board.rounds.map((round) => (
        <section key={round.round} aria-label={round.title}>
          <h4 className="board-round">{round.title}</h4>
          <ul className="board">
            {round.matches.map((m) => (
              <li key={m.id} className={m.stage}>
                <span className="who">
                  <b>{m.title}</b>: {m.hi ?? "?"} v {m.lo ?? "?"}
                </span>
                <span className={`chip ${m.stage}`}>{STAGE_LABEL[m.stage]}</span>
                <span className="note tight">{m.note}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <h4 className="board-round">Round update for the community chat</h4>
      <div className="msg">{update}</div>
      <div className="btns spaced">
        <a className="button" href={`https://wa.me/?text=${encodeURIComponent(update)}`} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </a>
      </div>
      <AutoSync everyMs={15_000} />
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

/** One admin: what they may do as tick boxes, a way back to a preset, and removal. The super admin only. */
function AdminRow({ admin }: { admin: AdminRecord }) {
  // The key changes when the saved ticks change, so the boxes always show what is saved.
  return (
    <ActionForm key={`${admin.username}:${admin.grants.join()}`} action={updateAdmin} className="admin">
      <input type="hidden" name="username" value={admin.username} />
      <h4>
        {admin.username} <span className="note">({admin.preset ?? "custom ticks"})</span>
      </h4>
      {GRANTABLE.map((permission) => (
        <label className="ck" key={permission}>
          <input type="checkbox" name="grant" value={permission} defaultChecked={admin.grants.includes(permission)} />
          <span>{PERMISSION_LABELS[permission]}</span>
        </label>
      ))}
      <div className="btns spaced">
        <SubmitButton name="do" value="save">
          Save access
        </SubmitButton>
        <SubmitButton name="do" value="referee" className="quiet">
          Use referee ticks
        </SubmitButton>
        <SubmitButton name="do" value="desk" className="quiet">
          Use desk ticks
        </SubmitButton>
        <SubmitButton name="do" value="remove" className="quiet">
          Remove admin
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function AdminsCard({
  admins,
  ended,
  canManage,
}: {
  admins: readonly AdminRecord[];
  ended: boolean;
  /** Only the super admin adds admins and changes their ticks. */
  canManage: boolean;
}) {
  return (
    <div className="card">
      <h3>Admins</h3>
      {admins.length === 0 && <p className="note tight">No admins yet. You are the only organizer.</p>}
      {canManage && !ended ? (
        admins.map((a) => <AdminRow key={a.username} admin={a} />)
      ) : (
        <ul className="log bare">
          {admins.map((a) => (
            <li key={a.username}>
              <b>{a.username}</b> ({a.preset ?? "custom"}):{" "}
              {a.grants.length === 0 ? "nothing" : a.grants.map((g) => PERMISSION_LABELS[g].toLowerCase()).join(", ")}
            </li>
          ))}
        </ul>
      )}
      {canManage && !ended && (
        <ActionForm action={addAdmin} className="admin">
          <h4>Add an admin</h4>
          <label htmlFor="admin-username">Their Lichess username</label>
          <input id="admin-username" name="username" autoCapitalize="none" autoCorrect="off" required />
          <label htmlFor="admin-preset">Start from</label>
          <select id="admin-preset" name="preset" defaultValue="referee">
            <option value="referee">Referee: results, no-shows, announcements</option>
            <option value="desk">Check-in desk: roster, announcements</option>
          </select>
          <SubmitButton className="wide">Add admin</SubmitButton>
          <p className="note">
            They log in with Lichess like everyone else and see only the tools you tick. Adding admins and ending the
            tournament stay with you alone.
          </p>
        </ActionForm>
      )}
      <p className="note">Admin access expires when the tournament ends.</p>
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
