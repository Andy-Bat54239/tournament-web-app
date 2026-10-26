import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createServer } from "node:net";
import pg from "pg";
import { pgSql, pgliteSql, type Sql } from "@/server/db/sql";

/** A database the tests can use, however it is reached. */
export interface TestDatabase {
  name: string;
  open(): Promise<{ sql: Sql; close(): Promise<void> }>;
}

/** PGlite, a real Postgres engine, running inside the test. */
export const inProcess: TestDatabase = {
  name: "PGlite in process",
  async open() {
    const db = new PGlite();
    await db.waitReady;
    const sql = pgliteSql(db);
    return { sql, close: () => sql.close() };
  },
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** The pg driver the app uses in production, talking the real Postgres wire protocol to PGlite. */
export const overTheWire: TestDatabase = {
  name: "pg driver over the wire protocol",
  async open() {
    const db = new PGlite();
    await db.waitReady;
    const port = await freePort();
    const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
    await server.start();
    // PGlite serves one connection at a time.
    const pool = new pg.Pool({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, max: 1 });
    return {
      sql: pgSql(pool),
      async close() {
        await pool.end();
        await server.stop();
        await db.close();
      },
    };
  },
};

/** A real Postgres server, when one is given: DATABASE_TEST_URL=postgres://... npx vitest run */
const realUrl = process.env.DATABASE_TEST_URL;
export const realPostgres: TestDatabase | null = realUrl
  ? {
      name: "the Postgres server in DATABASE_TEST_URL",
      async open() {
        const pool = new pg.Pool({ connectionString: realUrl, max: 3 });
        return { sql: pgSql(pool), close: () => pool.end() };
      },
    }
  : null;

export const databases: TestDatabase[] = [inProcess, overTheWire, ...(realPostgres ? [realPostgres] : [])];
