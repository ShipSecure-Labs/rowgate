import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  createKyselyInstance,
  migrate,
  createRowgateDb,
  resetDatabase,
  DB,
} from "./helpers/test-db-mysql";
import { sql, type Kysely } from "kysely";
import { RowGateNotSupportedError, RowGatePolicyError } from "@rowgate/core";

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

  it("disables raw SQL", async () => {
    await db
      .gated("1")
      .insertInto("Post")
      .values({
        id: "1",
        title: "Hello World",
        description: "Hello World",
        authorId: "1",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    await expect(async () =>
      db
        .gated("1")
        .selectFrom("Post")
        .select([
          sql<string>`(SELECT email FROM User WHERE User.id=Post.authorId LIMIT 1)`.as(
            "full_name",
          ),
        ])
        .execute(),
    ).rejects.toBeInstanceOf(RowGateNotSupportedError);
  });
});
