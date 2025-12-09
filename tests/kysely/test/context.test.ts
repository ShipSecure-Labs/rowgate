import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  createKyselyInstance,
  migrate,
  createRowgateDb,
  resetDatabase,
  DB,
} from "./helpers/test-db-mysql";
import type { Kysely } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/mysql";
import { RowGateContextError, RowGatePolicyError } from "@rowgate/core";

describe("RowGate Kysely adapter - Post policy (MySQL)", () => {
  let rawDb: Kysely<DB>;
  let db: ReturnType<typeof createRowgateDb>;

  beforeAll(async () => {
    const created = await createKyselyInstance();
    rawDb = created.db;
    await migrate(rawDb);
    db = createRowgateDb(rawDb);
  });

  afterAll(async () => {
    await rawDb.destroy();
  });

  beforeEach(async () => {
    await resetDatabase(rawDb);

    await db
      .ungated()
      .insertInto("User")
      .values({ id: "1", email: "real@example.com" })
      .execute();

    await db
      .ungated()
      .insertInto("User")
      .values({ id: "2", email: "other@example.com" })
      .execute();
  });

  it("validated the context correctly in runtime", async () => {
    await expect(
      db
        .gated(
          // @ts-ignore
          { tid: "123" },
        )
        .selectFrom("Post")
        .innerJoin("User", "Post.authorId", "User.id")
        .select(["Post.id", "Post.description", "User.email"])
        .executeTakeFirstOrThrow(),
    ).rejects.toBeInstanceOf(RowGateContextError);
  });
});
