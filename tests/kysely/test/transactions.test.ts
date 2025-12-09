import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import {
  createKyselyInstance,
  migrate,
  createRowgateDb,
  resetDatabase,
  DB,
} from "./helpers/test-db-mysql";
import type { Kysely } from "kysely";
import { RowGatePolicyError } from "@rowgate/core";

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

  it("has transaction support", async () => {
    await db
      .gated("1")
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto("Post")
          .values({
            id: "1",
            title: "Hello World",
            description: "Hello World",
            authorId: "2",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow();

        return await trx
          .insertInto("Post")
          .values({
            id: "2",
            title: "Hello World [owned by 2]",
            description: "Hello World",
            authorId: "2",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow();
      });
    // Post 2 should not be inserted, only post 1 is allowed

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .execute();

    expect(posts).toHaveLength(0);
  });

  it("supports manual transactions with savepoints", async () => {
    const trx = await db.gated("1").startTransaction().execute();

    try {
      // First insert is allowed (authorId === "1")
      await trx
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

      const trxAfterFirst = await trx.savepoint("after_first_post").execute();

      try {
        // This should violate the Post policy (authorId !== ctx) and throw RowGatePolicyError
        await trxAfterFirst
          .insertInto("Post")
          .values({
            id: "2",
            title: "Hello World [owned by 2]",
            description: "Hello World",
            authorId: "2",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();

        // If we get here, the policy didn't run
        throw new Error(
          "Expected RowGatePolicyError for inserting Post with authorId '2'",
        );
      } catch (err) {
        // Ensure the error is actually from RowGate
        expect(err).toBeInstanceOf(RowGatePolicyError);

        // Roll back just the failing insert
        await trxAfterFirst.rollbackToSavepoint("after_first_post").execute();
      }

      // Savepoint is no longer needed
      await trxAfterFirst.releaseSavepoint("after_first_post").execute();

      // Commit the outer transaction (should only persist Post "1")
      await trx.commit().execute();
    } catch (err) {
      // Something unexpected happened, roll back whole transaction and fail test
      await trx.rollback().execute();
      throw err;
    }

    // Verify only the allowed post is in the database
    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .orderBy("id")
      .execute();

    expect(posts).toEqual([{ id: "1", authorId: "1" }]);
  });
});
