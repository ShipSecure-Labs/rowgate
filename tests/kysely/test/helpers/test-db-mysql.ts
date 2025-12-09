import { Kysely, MysqlDialect, sql } from "kysely";
import { createPool, type Pool } from "mysql2";
import { createPool as createPoolPromise, type Pool } from "mysql2/promise";
import { withRowgate, kyselyAdapter } from "@rowgate/kysely";
import { z } from "zod";
import { randomBytes } from "crypto";

interface UserTable {
  id: string;
  email: string;
}

interface PostTable {
  id: string;
  title: string;
  description: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DB {
  User: UserTable;
  Post: PostTable;
}

const baseMysqlConfig = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || "3307"),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "rowgate",
  waitForConnections: true,
  connectionLimit: 50,
  ssl: {
    rejectUnauthorized: false,
  },
};

/**
 * Creates a new empty database using an admin connection (no DB selected).
 */
async function createDatabase(dbName: string) {
  const adminPool = createPoolPromise(baseMysqlConfig);
  const conn = await adminPool.getConnection();
  try {
    await conn.query(`CREATE DATABASE \`${dbName}\``);
  } finally {
    conn.release();
    await adminPool.end();
  }
}

/**
 * Drops a database using an admin connection.
 * Handy for test cleanup.
 */
export async function dropDatabase(dbName: string) {
  const adminPool = createPoolPromise(baseMysqlConfig);
  const conn = await adminPool.getConnection();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  } finally {
    conn.release();
    await adminPool.end();
  }
}

export async function createKyselyInstance(): Promise<{
  db: Kysely<DB>;
  dbName: string;
  pool: Pool;
}> {
  const dbName = "rowgate_test_" + randomBytes(6).toString("hex");

  // 1) actually create the DB
  await createDatabase(dbName);

  // 2) connect to the newly created DB
  const pool = createPool({
    ...baseMysqlConfig,
    database: dbName,
  });

  const dialect = new MysqlDialect({
    pool: async () => pool,
  });

  const db = new Kysely<DB>({ dialect });

  return { db, dbName, pool };
}

export async function migrate(rawDb: Kysely<DB>) {
  // Idempotent migrations for tests
  await rawDb.schema
    .createTable("User")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (col) => col.primaryKey())
    .addColumn("email", "varchar(255)", (col) => col.notNull())
    .execute();

  await rawDb.schema
    .createTable("Post")
    .ifNotExists()
    .addColumn("id", "varchar(36)", (col) => col.primaryKey())
    .addColumn("title", "varchar(255)", (col) => col.notNull())
    .addColumn("description", "text", (col) => col.notNull())
    .addColumn("authorId", "varchar(36)", (col) => col.notNull())
    .addColumn("createdAt", "datetime", (col) => col.notNull())
    .addColumn("updatedAt", "datetime", (col) => col.notNull())
    .execute();
}

export function createRowgateDb(rawDb: Kysely<DB>) {
  const db = withRowgate({
    context: z.string(),
    adapter: kyselyAdapter(rawDb),
    policy: (ctx) => ({
      User: {
        select: { filter: (qb, table) => qb.where(`${table}.id`, "=", ctx) },
        insert: {
          check: async (_db, row: UserTable) => !row.id || row.id === ctx,
        },
        update: {
          filter: (qb, table) => qb.where(`${table}.id`, "=", ctx),
          check: async (_db, row: UserTable) => !row.id || row.id === ctx,
        },
        delete: {
          filter: (qb, table) => qb.where(`${table}.id`, "=", ctx),
        },
      },
      Post: {
        select: {
          filter: (qb, table) => qb.where(`${table}.authorId`, "=", ctx),
        },
        insert: {
          check: async (_db, row: PostTable) =>
            !row.authorId || row.authorId === ctx,
        },
        update: {
          filter: (qb, table) => qb.where(`${table}.authorId`, "=", ctx),
          check: async (_db, row: PostTable) =>
            !row.authorId || row.authorId === ctx,
        },
        delete: {
          filter: (qb, table) => qb.where(`${table}.authorId`, "=", ctx),
        },
      },
    }),
  });

  return db;
}

export async function resetDatabase(rawDb: Kysely<DB>) {
  // Order matters because of FK-like relationships
  await rawDb.deleteFrom("Post").execute();
  await rawDb.deleteFrom("User").execute();
}

/**
 * Optional convenience: close everything for a test DB.
 */
export async function destroyTestDb(
  db: Kysely<DB>,
  pool: Pool,
  dbName: string,
) {
  await db.destroy();
  await pool.end();
  await dropDatabase(dbName);
}
