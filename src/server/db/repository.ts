import "server-only";
import type { Sql } from "./sql";

export interface Versioned<T> {
  state: T;
  /** Starts at 1 and goes up by one with every save. */
  version: number;
}

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
/** Postgres: a table or type that another connection created a moment ago. */
const ALREADY_THERE = new Set(["42P07", "23505", "42710"]);

/**
 * One JSON document per id, with a version number. A save only goes through if the version is the one the
 * caller read, so two servers writing at once cannot silently overwrite each other: the second finds the
 * version has moved on, gets `null`, and has to read again.
 */
export class StateRepository<T extends object> {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly sql: Sql,
    private readonly table = "tournament_state",
  ) {
    // The name goes into SQL text, since a table name cannot be a parameter.
    if (!TABLE_NAME.test(table)) throw new Error(`Not a safe table name: ${table}`);
  }

  /** Creates the table if it is missing. Safe to call from many places and many servers at once. */
  ensureSchema(): Promise<void> {
    this.ready ??= this.createTable().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  private async createTable(): Promise<void> {
    const create = () =>
      this.sql.query(
        `CREATE TABLE IF NOT EXISTS ${this.table} (
           id text PRIMARY KEY,
           version integer NOT NULL,
           state jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
    try {
      await create();
    } catch (error) {
      // Two servers starting together can both try to create it. If so, the other one won: check and move on.
      if (!ALREADY_THERE.has((error as { code?: string }).code ?? "")) throw error;
      await create();
    }
  }

  async load(id: string): Promise<Versioned<T> | null> {
    await this.ensureSchema();
    const { rows } = await this.sql.query<{ version: number; state: T }>(
      `SELECT version, state FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return rows[0] ? { version: rows[0].version, state: rows[0].state } : null;
  }

  /** Stores the first version. Returns false if someone else already did. */
  async create(id: string, state: T): Promise<boolean> {
    await this.ensureSchema();
    const { rows } = await this.sql.query(
      `INSERT INTO ${this.table} (id, version, state) VALUES ($1, 1, $2::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING version`,
      [id, JSON.stringify(state)],
    );
    return rows.length === 1;
  }

  /** Saves a new state if the stored version is still `expected`. Returns the new version, or null if it moved on. */
  async save(id: string, state: T, expected: number): Promise<number | null> {
    await this.ensureSchema();
    const { rows } = await this.sql.query<{ version: number }>(
      `UPDATE ${this.table} SET state = $2::jsonb, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $3 RETURNING version`,
      [id, JSON.stringify(state), expected],
    );
    return rows[0]?.version ?? null;
  }
}
