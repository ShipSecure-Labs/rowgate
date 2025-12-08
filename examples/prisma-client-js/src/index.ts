import { PrismaClient } from "@prisma/client";
import { withRowgate, prismaAdapter } from "@rowgate/prisma";
import { z } from "zod";

const prisma = new PrismaClient();


const db = withRowgate({
  context: z.string(),
  adapter: prismaAdapter(prisma),
  policy: {
    user: (ctx) => ({
      select: {
        filter: { id: ctx },
      },
      insert: {
        check: { id: ctx },
      },
      update: {
        filter: { id: ctx },
        check: { id: ctx },
      },
      delete: { filter: { id: ctx } },
    }),
    post: (ctx) => ({
      select: { filter: { author: { id: ctx } } },
      insert: { check: { authorId: ctx } },
      update: { filter: { author: { id: ctx } }, check: { authorId: ctx } },
      delete: { filter: { author: { id: ctx } } },
    }),
  },
});

async function main() {
  // Clean up DB
  await db.ungated().post.deleteMany({});
  await db.ungated().user.deleteMany({});

  let user = await db.ungated().user.findUnique({
    where: { email: "test@example.com" },
  });
  if (!user) {
    user = await db.ungated().user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });
  }
  const p = await db.gated(user.id).post.create({
    data: {
      title: "Test Post",
      description: "This is a test post",
      authorId: user.id,
    },
  });
  const posts = await db.gated(user.id).post.findMany({});

  console.log(posts);
}

main();
