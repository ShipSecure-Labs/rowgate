import { PrismaClient } from "@prisma/client";
import { withRowgate, prismaAdapter } from "@rowgate/prisma";
import { z } from "zod";

const prisma = new PrismaClient();

const db = withRowgate({
  context: z.string(),
  adapter: prismaAdapter(prisma),
  policy: {
    user: (ctx) => {
      return { where: { id: ctx } };
    },
    post: (ctx) => {
      return { where: { author: { id: ctx } } };
    },
  },
});

async function main() {
  // Clean up DB
  await db.without().post.deleteMany({});
  await db.without().user.deleteMany({});

  let user = await db.without().user.findUnique({
    where: { email: "test@example.com" },
  });
  if (!user) {
    user = await db.without().user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });
  }
  const p = await db.with(user.id).post.create({
    data: {
      title: "Test Post",
      description: "This is a test post",
      author: { connect: { id: user.id } },
    },
  });
  const posts = await db.with(user.id).post.findMany({});

  console.log(posts);
}

main();
