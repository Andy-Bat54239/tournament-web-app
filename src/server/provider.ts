import "server-only";
import type { StateRepository } from "./db/repository";
import { Store, type PersistedState } from "./store";

/** Thrown when a change kept losing the race against other changes. Nothing was saved. */
export class StoreBusy extends Error {
  constructor() {
    super("The tournament was changed by others at the same moment, every time we tried.");
    this.name = "StoreBusy";
  }
}

export interface ProviderOptions {
  /** Which tournament in the table. There is one. */
  id?: string;
  /** Lichess username of the super admin. Settings, not saved state. */
  superAdmin: string | null;
  /** The state to start from the first time the app runs against an empty database. */
  initial: () => PersistedState;
  /** Closes a game link on Lichess. Best effort: a failure here is swallowed. */
  closeLink: (id: string) => Promise<void>;
  /** How many times a change is tried before giving up. */
  attempts?: number;
  /** Waits a little before trying again. Replaced in tests. */
  pause?: (attempt: number) => Promise<void>;
}

const randomPause = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.random() * 40 * attempt));

/** Ids of the game links the saved state still uses. */
function linksIn(state: PersistedState): Set<string> {
  const used = new Set<string>();
  for (const play of Object.values(state.tournament.play ?? {})) {
    if (play.round?.link) used.add(play.round.link.id);
  }
  return used;
}

/**
 * Hands out working copies of the tournament kept in Postgres.
 *
 * `read` loads a copy for showing. `update` loads a copy, lets the caller change it, and saves it back only if
 * nobody else saved in between. If somebody did, the change is thrown away and made again on the newer state, so
 * two organizers (or two players) acting at the same moment never overwrite each other. That means the function
 * given to `update` can run more than once: it must only change the store it is given.
 */
export class StoreProvider {
  private readonly id: string;
  private readonly attempts: number;
  private readonly pause: (attempt: number) => Promise<void>;

  constructor(
    private readonly repository: StateRepository<PersistedState>,
    private readonly options: ProviderOptions,
  ) {
    this.id = options.id ?? "main";
    this.attempts = options.attempts ?? 6;
    this.pause = options.pause ?? randomPause;
  }

  private async load(): Promise<{ store: Store; version: number }> {
    let row = await this.repository.load(this.id);
    if (!row) {
      // The first run. If another server got there first, theirs is the one that counts.
      await this.repository.create(this.id, this.options.initial());
      row = await this.repository.load(this.id);
      if (!row) throw new Error("The tournament could not be created in the database.");
    }
    return { store: Store.fromState(row.state, this.options.superAdmin), version: row.version };
  }

  /** A copy of the tournament as it is now. For showing: changes to it are not saved. */
  async read(): Promise<Store> {
    return (await this.load()).store;
  }

  async update<T>(change: (store: Store) => Promise<T> | T): Promise<T> {
    const made = new Set<string>();
    let kept: PersistedState | null = null;
    try {
      for (let attempt = 1; attempt <= this.attempts; attempt++) {
        const { store, version } = await this.load();
        const before = JSON.stringify(store.snapshot());
        let value: T;
        try {
          value = await change(store);
        } finally {
          for (const id of store.play.takeMadeLinks()) made.add(id);
        }

        const snapshot = store.snapshot();
        if (JSON.stringify(snapshot) === before) {
          kept = snapshot;
          return value;
        }
        if ((await this.repository.save(this.id, snapshot, version)) !== null) {
          kept = snapshot;
          await this.closeLinks(store.play.takeCancels());
          return value;
        }
        await this.pause(attempt);
      }
      throw new StoreBusy();
    } finally {
      await this.closeUnused(made, kept);
    }
  }

  /** Closes links on Lichess, one at a time. A failure is fine: unused links expire on their own. */
  private async closeLinks(ids: Iterable<string>) {
    for (const id of ids) await this.options.closeLink(id).catch(() => undefined);
  }

  /** Links this call made that the tournament does not use: the change lost a race, failed, or changed its mind. */
  private async closeUnused(made: Set<string>, kept: PersistedState | null) {
    if (made.size === 0) return;
    try {
      const used = linksIn(kept ?? (await this.load()).store.snapshot());
      await this.closeLinks([...made].filter((id) => !used.has(id)));
    } catch {
      // The links expire on their own after 20 minutes.
    }
  }
}
