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

  //
  // .transaction() tests
  //

  it("commits all allowed inserts inside .transaction()", async () => {
    await db
      .gated("1")
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto("Post")
          .values({
            id: "1",
            title: "Hello World #1",
            description: "Hello World #1",
            authorId: "1",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("Post")
          .values({
            id: "2",
            title: "Hello World #2",
            description: "Hello World #2",
            authorId: "1", // still allowed for ctx "1"
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow();
      });

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .orderBy("id")
      .execute();

    expect(posts).toEqual([
      { id: "1", authorId: "1" },
      { id: "2", authorId: "1" },
    ]);
  });

  it("executes policy checks inside .transaction() and persists only valid rows", async () => {
    await db
      .gated("1")
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto("Post")
          .values({
            id: "1",
            title: "Allowed post",
            description: "Allowed",
            authorId: "1",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow();

        // This should fail policy (authorId !== ctx)
        await expect(
          trx
            .insertInto("Post")
            .values({
              id: "2",
              title: "Forbidden post",
              description: "Forbidden",
              authorId: "2",
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .executeTakeFirstOrThrow(),
        ).rejects.toBeInstanceOf(RowGatePolicyError);
      });

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .orderBy("id")
      .execute();

    // Only the allowed row should have made it through
    expect(posts).toEqual([{ id: "1", authorId: "1" }]);
  });

  it("rolls back the whole .transaction() when the callback throws a non-policy error", async () => {
    await expect(
      db
        .gated("1")
        .transaction()
        .execute(async (trx) => {
          await trx
            .insertInto("Post")
            .values({
              id: "1",
              title: "Will be rolled back",
              description: "This should not persist",
              authorId: "1",
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .executeTakeFirstOrThrow();

          // Simulate some unexpected failure in user code
          throw new Error("Unexpected application error");
        }),
    ).rejects.toThrow("Unexpected application error");

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .execute();

    // Entire transaction should have been rolled back
    expect(posts).toHaveLength(0);
  });

  it("enforces policy checks when mixing .transaction() with reads and writes", async () => {
    await db
      .gated("1")
      .transaction()
      .execute(async (trx) => {
        const users = await trx
          .selectFrom("User")
          .select(["id", "email"])
          .orderBy("id")
          .execute();

        expect(users).toHaveLength(1);

        await trx
          .insertInto("Post")
          .values({
            id: "1",
            title: "Owned by gated user",
            description: "Owned by 1",
            authorId: "1",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow();

        await expect(
          trx
            .insertInto("Post")
            .values({
              id: "2",
              title: "Owned by other user",
              description: "Owned by 2",
              authorId: "2",
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .executeTakeFirstOrThrow(),
        ).rejects.toBeInstanceOf(RowGatePolicyError);
      });

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .orderBy("id")
      .execute();

    expect(posts).toEqual([{ id: "1", authorId: "1" }]);
  });

  //
  // Manual transaction (startTransaction) tests
  //

  it("supports manual transactions: commit persists allowed rows", async () => {
    const trx = await db.gated("1").startTransaction().execute();

    try {
      await trx
        .insertInto("Post")
        .values({
          id: "1",
          title: "Manual trx allowed",
          description: "Allowed",
          authorId: "1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .executeTakeFirstOrThrow();

      await trx
        .insertInto("Post")
        .values({
          id: "2",
          title: "Manual trx also allowed",
          description: "Allowed",
          authorId: "1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .executeTakeFirstOrThrow();

      await trx.commit().execute();
    } catch (err) {
      await trx.rollback().execute();
      throw err;
    }

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .orderBy("id")
      .execute();

    expect(posts).toEqual([
      { id: "1", authorId: "1" },
      { id: "2", authorId: "1" },
    ]);
  });

  it("supports manual transactions: rollback discards all changes", async () => {
    const trx = await db.gated("1").startTransaction().execute();

    try {
      await trx
        .insertInto("Post")
        .values({
          id: "1",
          title: "Will be rolled back (manual)",
          description: "Should not persist",
          authorId: "1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .executeTakeFirstOrThrow();

      await trx.rollback().execute();
    } catch (err) {
      // Even if something unexpected happens, ensure rollback
      await trx.rollback().execute();
      throw err;
    }

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .execute();

    expect(posts).toHaveLength(0);
  });

  it("supports manual transactions: policy error causes rollback and no rows persist", async () => {
    const trx = await db.gated("1").startTransaction().execute();

    try {
      await trx
        .insertInto("Post")
        .values({
          id: "1",
          title: "Allowed before error",
          description: "Allowed",
          authorId: "1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .executeTakeFirstOrThrow();

      await expect(
        trx
          .insertInto("Post")
          .values({
            id: "2",
            title: "Forbidden in manual trx",
            description: "Forbidden",
            authorId: "2",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow(),
      ).rejects.toBeInstanceOf(RowGatePolicyError);

      // Application chooses to roll back entire transaction
      await trx.rollback().execute();
    } catch (err) {
      await trx.rollback().execute();
      throw err;
    }

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .execute();

    // Even the first allowed row should be gone due to rollback
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
        // This should violate the Post policy (authorId !== ctx)
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

  it("supports multiple savepoints and only rolls back to the last one", async () => {
    const trx = await db.gated("1").startTransaction().execute();

    try {
      await trx
        .insertInto("Post")
        .values({
          id: "1",
          title: "Post 1",
          description: "Post 1",
          authorId: "1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .executeTakeFirstOrThrow();

      const sp1 = await trx.savepoint("sp1").execute();

      await sp1
        .insertInto("Post")
        .values({
          id: "2",
          title: "Post 2",
          description: "Post 2",
          authorId: "1",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .executeTakeFirstOrThrow();

      const sp2 = await sp1.savepoint("sp2").execute();

      // This insert should fail due to policy
      await expect(
        sp2
          .insertInto("Post")
          .values({
            id: "3",
            title: "Forbidden post at sp2",
            description: "Forbidden",
            authorId: "2",
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .executeTakeFirstOrThrow(),
      ).rejects.toBeInstanceOf(RowGatePolicyError);

      // Roll back only to sp2 -> removes id "3" attempt, but keeps id "2"
      await sp2.rollbackToSavepoint("sp2").execute();

      // Release both savepoints (no-op with respect to data)
      await sp2.releaseSavepoint("sp2").execute();
      await sp1.releaseSavepoint("sp1").execute();

      await trx.commit().execute();
    } catch (err) {
      await trx.rollback().execute();
      throw err;
    }

    const posts = await db
      .ungated()
      .selectFrom("Post")
      .select(["id", "authorId"])
      .orderBy("id")
      .execute();

    // Post 1 and 2 persist, failed post 3 does not
    expect(posts).toEqual([
      { id: "1", authorId: "1" },
      { id: "2", authorId: "1" },
    ]);
  });
});
