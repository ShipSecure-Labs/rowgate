import { withRowgate, kyselyAdapter } from "@rowgate/kysely";
import { z } from "zod";
import { dialect, DB } from "./db";
import { Kysely } from "kysely";

const rawDb = new Kysely<DB>({
  dialect,
});

const db = withRowgate({
  context: z.string(),
  adapter: kyselyAdapter(rawDb),
  policy: {
    Post: (ctx) => ({
      select: { filter: (qb) => qb.where("Post.authorId", "=", ctx) },
      insert: {
        check: async (_, row) => {
          return row.authorId == ctx;
        },
      },
      update: {
        filter: (qb) => qb.where("Post.authorId", "=", ctx),
        check: async (_, row) => {
          return row.authorId == ctx;
        },
      },
      delete: { filter: (qb) => qb.where("Post.authorId", "=", ctx) },
    }),
  },
});

async function main() {
  // Clean up DB
  await db.ungated().deleteFrom("Post").execute();
  await db.ungated().deleteFrom("User").execute();

  await db
    .ungated()
    .insertInto("User")
    .values({
      id: "1",
      email: "real@example.com",
    })
    .execute();
  await db
    .ungated()
    .insertInto("User")
    .values({
      id: "2",
      email: "other@example.com",
    })
    .execute();

  console.log("Inserted users");

  const userId = "1";

  await db
    .gated("1")
    .insertInto("Post")
    .values({
      id: "1",
      title: "Hello World",
      description: "Hello World",
      authorId: "1",
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    .execute();
  await db
    .gated("2")
    .insertInto("Post")
    .values({
      id: "2",
      title: "Hello World [unauthoirzed]",
      description: "Hello World",
      authorId: "2",
      updatedAt: new Date(),
      createdAt: new Date(),
    })
    .execute();

  try {
    await db
      .gated("2")
      .insertInto("Post")
      .values({
        id: "3",
        title: "Hello World [unauthoirzed]",
        description: "Hello World",
        authorId: "3",
        updatedAt: new Date(),
        createdAt: new Date(),
      })
      .execute();
  } catch (e) {
    console.log(e);
  }

  console.log("User 1");
  await db
    .gated(userId)
    .updateTable("Post")
    .set({
      description: "Hello World [updated]",
    })
    .execute();
  const posts = await db
    .gated(userId)
    .selectFrom(["Post"])
    .innerJoin("User", "Post.authorId", "User.id")
    .select(["Post.id", "Post.description", "User.email"])
    .execute();
  await db.gated(userId).deleteFrom("Post").execute();
  const posts2 = await db
    .gated(userId)
    .selectFrom(["Post"])
    .innerJoin("User", "Post.authorId", "User.id")
    .select(["Post.id", "Post.description", "User.email"])
    .execute();
  console.log(posts);
  console.log(posts2);

  console.log("User 2");
  const posts3 = await db
    .gated("2")
    .selectFrom(["Post"])
    .innerJoin("User", "Post.authorId", "User.id")
    .select(["Post.id", "Post.description", "User.email"])
    .execute();
  console.log(posts3);
}

main();
