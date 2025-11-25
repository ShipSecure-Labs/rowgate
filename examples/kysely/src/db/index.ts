import { ConnectionString } from "connection-string";
import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
import { DB as Schema } from "./schema";
import { config } from "dotenv";

config();

process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (!("code" in warning) || warning.code !== "DEP0123") {
    console.warn(warning.stack);
  }
});

console.log(process.env.DATABASE_URL);

const conf = new ConnectionString(process.env.DATABASE_URL);

export const dialect = new MysqlDialect({
  pool: createPool({
    host: conf.hostname,
    port: conf.port,
    user: conf.user,
    password: conf.password,
    database: conf?.path?.length ? conf.path[0] : undefined,
    timezone: "Z",
    ssl: {
      rejectUnauthorized: false,
    },
  }),
});

export type Database = Kysely<Schema>;
export type DB = Schema;
