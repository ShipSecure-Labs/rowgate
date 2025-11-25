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
      insert: { check: { authorId: ctx } },
      update: {
        filter: (qb) => qb.where("Post.authorId", "=", ctx),
        check: {
          authorId: ctx,
        },
      },
      delete: { filter: (qb) => qb.where("Post.authorId", "=", ctx) },
    }),
  },
});

async function main() {
  // Clean up DB
  await db.system().deleteFrom("Post").execute();
  await db.system().deleteFrom("User").execute();

  await db
    .system()
    .insertInto("User")
    .values({
      id: "1",
      email: "real@example.com",
    })
    .execute();
  await db
    .system()
    .insertInto("User")
    .values({
      id: "2",
      email: "other@example.com",
    })
    .execute();

  console.log("Inserted user");

  const userId = "1";

  await db
    .with("1")
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
    .with("2")
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
      .with("2")
      .insertInto("Post")
      .values({
        id: "2",
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
    .with(userId)
    .updateTable("Post")
    .set({
      description: "Hello World [updated]",
    })
    .execute();
  const posts = await db
    .with(userId)
    .selectFrom(["Post"])
    .innerJoin("User", "Post.authorId", "User.id")
    .select(["Post.id", "Post.description", "User.email"])
    .execute();
  await db.with(userId).deleteFrom("Post").execute();
  const posts2 = await db
    .with(userId)
    .selectFrom(["Post"])
    .innerJoin("User", "Post.authorId", "User.id")
    .select(["Post.id", "Post.description", "User.email"])
    .execute();
  console.log(posts);
  console.log(posts2);

  console.log("User 2");
  const posts3 = await db
    .with("2")
    .selectFrom(["Post"])
    .innerJoin("User", "Post.authorId", "User.id")
    .select(["Post.id", "Post.description", "User.email"])
    .execute();
  console.log(posts3);
}

main();
