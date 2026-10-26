import "server-only";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";

/**
 * The little the app needs from a database, so the production driver (pg) and the local one (PGlite, a real
 * Postgres engine running inside Node) are interchangeable, and the rest of the code never knows which it has.
 */
export interface Sql {
  query<T extends object = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export function pgSql(pool: Pool): Sql {
  return {
    async query<T extends object>(text: string, params?: unknown[]) {
      const result = await pool.query(text, params);
      return { rows: result.rows as T[] };
    },
    close: () => pool.end(),
  };
}

export function pgliteSql(db: PGlite): Sql {
  return {
    async query<T extends object>(text: string, params?: unknown[]) {
      const result = await db.query<T>(text, params);
      return { rows: result.rows };
    },
    close: () => db.close(),
  };
}
