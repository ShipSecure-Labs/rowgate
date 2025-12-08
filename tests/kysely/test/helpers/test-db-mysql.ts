import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import { withRowgate, kyselyAdapter } from "@rowgate/kysely";
import { z } from "zod";

// If you already export DB type from your library, import that instead.
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

export async function createKyselyInstance() {
  const pool = createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || "3307"),
    user: process.env.MYSQL_USER || "rowgate",
    password: process.env.MYSQL_PASSWORD || "rowgate",
    database: process.env.MYSQL_DATABASE || "rowgate_test",
    waitForConnections: true,
    connectionLimit: 10,
    ssl: {
      rejectUnauthorized: false,
    },
  });
  const dialect = new MysqlDialect({
    pool: async () => pool,
  });

  const db = new Kysely<DB>({
    dialect,
  });

  return { db };
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
