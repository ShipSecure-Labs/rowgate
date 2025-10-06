import { PrismaClient } from "@prisma/client";
import { withGatekeeper, prismaAdapter } from "@shipsecure/gatekeeper-prisma";

const prisma = new PrismaClient();

const db = withGatekeeper({
  adapter: prismaAdapter(prisma),
  policy: {
    post: (ctx: string) => {
      return { where: { authorId: ctx } };
    },
    user: (ctx: string) => {
      return { where: { id: ctx } };
    },
  },
});

async function main() {
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
