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

  it("applies Post policies when selecting from aliased tables", async () => {
    const now = new Date();

    await db
      .ungated()
      .insertInto("Post")
      .values({
        id: "1",
        title: "Owned by 1",
        description: "Owned by 1",
        authorId: "1",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await db
      .ungated()
      .insertInto("Post")
      .values({
        id: "2",
        title: "Owned by 2",
        description: "Owned by 2",
        authorId: "2",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const postsUser1 = await db
      .gated("1")
      .selectFrom("Post as p")
      .select(["p.id", "p.authorId"])
      .orderBy("p.id")
      .execute();

    expect(postsUser1).toHaveLength(1);
    expect(postsUser1[0].authorId).toBe("1");
  });

  it("applies Post policies when using withSchema", async () => {
    const now = new Date();

    await db
      .ungated()
      .insertInto("Post")
      .values({
        id: "1",
        title: "Owned by 1",
        description: "Owned by 1",
        authorId: "1",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await db
      .ungated()
      .insertInto("Post")
      .values({
        id: "2",
        title: "Owned by 2",
        description: "Owned by 2",
        authorId: "2",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const postsUser1 = await db
      .gated("2")
      .withSchema("rowgate_test")
      .selectFrom("Post")
      .select(["Post.id", "Post.authorId"])
      .execute();

    expect(postsUser1).toHaveLength(1);
    expect(postsUser1[0].authorId).toBe("2");
  });

  it("applies Post policies inside CTEs created with with()", async () => {
    const now = new Date();

    await db
      .ungated()
      .insertInto("Post")
      .values({
        id: "1",
        title: "Owned by 1",
        description: "Owned by 1",
        authorId: "1",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    await db
      .ungated()
      .insertInto("Post")
      .values({
        id: "2",
        title: "Owned by 2",
        description: "Owned by 2",
        authorId: "2",
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const postsFromCte = await db
      .gated("2")
      .with("user_posts", (qb) => qb.selectFrom("Post").selectAll())
      .selectFrom("user_posts")
      .selectAll()
      .execute();

    expect(postsFromCte).toHaveLength(1);
    expect((postsFromCte as any)[0].authorId).toBe("2");
  });

  it("applies Post policies for insert expressions with subqueries", async () => {
    const now = new Date();

    await expect(
      (async () => {
        // The RowGateNotSupportedError is thrown here,
        // inside an async function -> becomes a rejected Promise.
        db.gated("2")
          .insertInto("Post")
          .columns([
            "id",
            "title",
            "description",
            "authorId",
            "createdAt",
            "updatedAt",
          ])
          .expression((eb) =>
            eb
              .selectFrom("User")
              .select((eb2) => [
                eb2.val("expr-post").as("id"),
                eb2.val("From expression").as("title"),
                eb2.val("From expression").as("description"),
                eb2.ref("User.id").as("authorId"),
                eb2.val(now).as("createdAt"),
                eb2.val(now).as("updatedAt"),
              ])
              .where("User.id", "in", ["1", "2"])
              .orderBy("User.id", "asc")
              .limit(1),
          )
          .execute();
      })(),
    ).rejects.toBeInstanceOf(RowGateNotSupportedError);

    const postsForCtx2 = await db
      .gated("2")
      .selectFrom("Post")
      .select(["id", "authorId"])
      .execute();

    expect(postsForCtx2).toHaveLength(0);
  });

  // it("applies Post policies inside where callback subqueries", async () => {
  //   const now = new Date();

  //   // Insert a post for author 2 only, ungated
  //   await db
  //     .ungated()
  //     .insertInto("Post")
  //     .values({
  //       id: "1",
  //       title: "Owned by 2",
  //       description: "Owned by 2",
  //       authorId: "2",
  //       createdAt: now,
  //       updatedAt: now,
  //     })
  //     .execute();

  //   // From the perspective of ctx=1:
  //   // - If the subquery in where() is NOT filtered by ctx, it sees the Post
  //   //   with authorId=2 and notExists(...) will be false → 0 rows.
  //   // - If it IS filtered, it sees no posts with authorId=2 and notExists(...)
  //   //   is true → 1 row.
  //   const usersForCtx1 = await db
  //     .gated("1")
  //     .selectFrom("User")
  //     .selectAll()
  //     .where("User.id", "=", "1")
  //     .where((eb) =>
  //       eb.not(
  //         eb.exists((qb) =>
  //           qb.selectFrom("Post").select("id").where("Post.authorId", "=", "2"),
  //         ),
  //       ),
  //     )
  //     .execute();

  //   expect(usersForCtx1).toHaveLength(1);
  //   expect(usersForCtx1[0].id).toBe("1");
  // });
});
