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

  it("allows user to CRUD only own posts and scopes selects correctly", async () => {
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

    await db
      .gated("2")
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

    await expect(
      db
        .gated("2")
        .insertInto("Post")
        .values({
          id: "3",
          title: "Hello World [unauthorized]",
          description: "Hello World",
          authorId: "3",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute(),
    ).rejects.toBeInstanceOf(RowGatePolicyError);

    await db
      .gated("1")
      .updateTable("Post")
      .set({ description: "Hello World [updated]" })
      .execute();

    const postsUser1 = await db
      .gated("1")
      .selectFrom(["Post"])
      .innerJoin("User", "Post.authorId", "User.id")
      .select(["Post.id", "Post.description", "User.email"])
      .execute();

    expect(postsUser1).toHaveLength(1);
    expect(postsUser1[0].id).toBe("1");
    expect(postsUser1[0].description).toBe("Hello World [updated]");
    expect(postsUser1[0].email).toBe("real@example.com");

    const postsUser2 = await db
      .gated("2")
      .selectFrom(["Post"])
      .innerJoin("User", "Post.authorId", "User.id")
      .select(["Post.id", "Post.description", "User.email"])
      .execute();

    expect(postsUser2).toHaveLength(1);
    expect(postsUser2[0].id).toBe("2");
    expect(postsUser2[0].email).toBe("other@example.com");

    await db
      .gated("1")
      .updateTable("Post")
      .set({ description: "Updated" })
      .where("Post.id", "=", "1")
      .execute();
    await db
      .gated("1")
      .updateTable("Post")
      .set({ description: "Updated" })
      .where("Post.id", "=", "2")
      .execute();

    // policy check

    await expect(
      db.gated("1").updateTable("Post").set({ authorId: "2" }).execute(),
    ).rejects.toBeInstanceOf(RowGatePolicyError);

    const post1 = await db
      .gated("1")
      .selectFrom(["Post"])
      .select(["Post.id", "Post.description"])
      .where("Post.id", "=", "1")
      .executeTakeFirst();
    expect(post1?.description).toBe("Updated");

    const post2 = await db
      .gated("2")
      .selectFrom(["Post"])
      .select(["Post.id", "Post.description"])
      .where("Post.id", "=", "2")
      .executeTakeFirst();
    expect(post2?.description).toBe("Hello World");

    await db.gated("1").deleteFrom("Post").execute();

    const postsUser1AfterDelete = await db
      .gated("1")
      .selectFrom(["Post"])
      .innerJoin("User", "Post.authorId", "User.id")
      .select(["Post.id", "Post.description", "User.email"])
      .execute();

    expect(postsUser1AfterDelete).toHaveLength(0);
  });

  it("works correctly with subqueries", async () => {
    await db
      .gated("2")
      .insertInto("Post")
      .values({
        id: "1",
        title: "Hello World",
        description: "Hello World",
        authorId: "2",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    const postsUser1 = await db
      .gated("2")
      .selectFrom(["Post"])
      .select((eb) =>
        eb
          .selectFrom("User")
          .select((eb2) => ["email"])
          .limit(1)
          .as("authorEmail"),
      )
      .execute();

    expect(postsUser1).toHaveLength(1);
    expect(postsUser1[0].authorEmail).toBe("other@example.com");
  });

  it("works correctly with jsonObjectFrom/jsonArrayFrom subqueries", async () => {
    await db
      .gated("2")
      .insertInto("Post")
      .values({
        id: "1",
        title: "Hello World",
        description: "Hello World",
        authorId: "2",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    const postsUser1 = await db
      .gated("2")
      .selectFrom(["Post"])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom("User")
            .select("email")
            .where("User.id", "=", "2")
            .limit(1),
        ).as("author"),
      ])
      .execute();

    expect(postsUser1).toHaveLength(1);
    expect(postsUser1[0].author?.email).toBe("other@example.com");

    const postsUser2 = await db
      .gated("2")
      .selectFrom(["Post"])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom("User")
            .select("email")
            .where("User.id", "=", "1")
            .limit(1),
        ).as("author"),
      ])
      .execute();

    expect(postsUser2).toHaveLength(1);
    expect(postsUser2[0].author).toBe(null);
  });

  it("works correctly with deeply nested jsonObjectFrom/jsonArrayFrom subqueries", async () => {
    await db
      .gated("2")
      .insertInto("Post")
      .values({
        id: "1",
        title: "Hello World",
        description: "Hello World",
        authorId: "2",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    const postsUser1 = await db
      .gated("2")
      .selectFrom(["Post"])
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom("User")
            .select("email")
            .where("User.id", "=", "2")
            .limit(1),
        ).as("author"),
      ])
      .execute();

    expect(postsUser1).toHaveLength(1);
    expect(postsUser1[0].author?.email).toBe("other@example.com");
  });
});
