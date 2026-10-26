import "server-only";
import { pgSql, pgliteSql, type Sql } from "./sql";

/**
 * Which database the app uses:
 *   DATABASE_URL set      Postgres, through the pg driver. This is what a real event uses.
 *   otherwise, in development   PGlite, a real Postgres engine kept in a folder (.data/pglite, or PGLITE_DIR),
 *                         so data survives a restart with nothing to install.
 *   otherwise, in production    refused, because an event must never run on a database that is not kept safe.
 *                         ALLOW_LOCAL_DATABASE=true overrides this, for trying `next start` on your own machine.
 */

export async function openPostgres(url: string): Promise<Sql> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle connection dropped by the server must not crash the process: the pool opens a new one when needed.
  pool.on("error", (error) => console.error("Postgres connection error:", error.message));
  return pgSql(pool);
}

export async function openPglite(dir?: string): Promise<Sql> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dir);
  await db.waitReady;
  return pgliteSql(db);
}

const holder = globalThis as unknown as { __castleConnectSql?: Promise<Sql> };

async function open(): Promise<Sql> {
  const url = process.env.DATABASE_URL;
  if (url) return openPostgres(url);
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_DATABASE !== "true") {
    throw new Error("DATABASE_URL must be set in production, so the tournament is kept in Postgres.");
  }
  return openPglite(process.env.PGLITE_DIR ?? ".data/pglite");
}

/** One connection for the whole process, kept on globalThis so a dev-server reload does not open a second one. */
export function getSql(): Promise<Sql> {
  holder.__castleConnectSql ??= open().catch((error) => {
    delete holder.__castleConnectSql;
    throw error;
  });
  return holder.__castleConnectSql;
}
