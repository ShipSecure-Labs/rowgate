# RowGate

RowGate is a lightweight, framework-agnostic **Row-Level Security
(RLS)** engine for TypeScript applications. It lets you define
**policies** in your application code and automatically enforces them on
all database queries - select, insert, update, and delete.

RowGate is inspired by the safety of Postgres RLS, but built to be
portable across different databases, ORMs, and query builders.

## 🚀 Features

- **Universal RLS** - works with any database or query system via
  adapters.
- **Type-safe policies** - enforced at runtime, defined in
  TypeScript.
- **Composable and declarative** - policies are simple objects
  describing filters and checks.
- **Context-aware** - each request can carry its own auth/user
  context.
- **Adapter-based architecture** - easy to add support for
  additional ORMs/DB layers.

## 📦 Installation

```sh
pnpm add @rowgate/core
```

Adapters are installed separately:

```sh
pnpm add @rowgate/kysely
# or
pnpm add @rowgate/prisma
```

You can also install the adapter directly - they have `@rowgate/core` as a dependency.

## 🧠 How RowGate Works

RowGate wraps your database client using a small higher-order function:

```ts
import { withRowgate } from "@rowgate/core";

const db = withRowgate({
  context: z.string(), // your user context type
  adapter: yourAdapter, // any supported adapter
  policy: {
    // table policies
  },
});
```

## 📚 Example (conceptual)

```ts
const db = withRowgate({
  context: z.string(),
  adapter: someAdapter(dbClient),
  policy: {
    Post: (userId) => ({
      select: { filter: (qb) => qb.where("authorId", "=", userId) },
      insert: { check: (row) => row.authorId === userId },
      update: {
        filter: (qb) => qb.where("authorId", "=", userId),
        check: (row) => row.authorId === userId,
      },
      delete: { filter: (qb) => qb.where("authorId", "=", userId) },
    }),
  },
});
```

## 🔌 Adapters

### Supported

- **Kysely** --- `@rowgate/kysely`\
  **Status:** ✅ Stable

### In Progress

- **Prisma** --- `@rowgate/prisma`\
  **Status:** 🚧 Work in progress; API may change

## 🛠 Custom Adapters

RowGate exposes a minimal `Adapter` interface that you can implement to
add support for any ORM or raw DB client.

## 📄 License

MIT --- see `LICENSE` for details.
