import { Adapter, Policy } from "@rowgate/core";
export { withRowgate } from "@rowgate/core";
import type { PrismaClient } from "./types/prisma";
import type { Prisma } from "@prisma/client";

/**
 * We need `Prisma` type from `@prisma/client` to type certain parts of the adapter
 * 
 * This should be ok, since the `@prisma/client` package is a peer dependency of this package
 * and `Prisma` is a global type used across different Prisma clients and is located inside `@prisma/client`.
 */

const ATTACH_METHODS = [
  "findFirst",
  "findMany",
  "findUnique",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "create",
  "createMany",
  "count",
  "sum",
  "min",
  "max",
];

type ModelNameOf<RawAdapter extends PrismaClient> =
  Extract<keyof RawAdapter, string> extends infer K extends string
    ? K extends `$${string}`
      ? never
      : K
    : never;

/**
 * For Prisma, the policy filter is a where clause object
 */
type PolicyFilter<RawAdapter extends PrismaClient> = {
  [K in ModelNameOf<RawAdapter>]: Prisma.Args<RawAdapter[K], 'findMany'>['where']
};

/**
 * For Prisma, the policy check is a where clause object
 * 
 * NOTE: Based on the `kysely` implementation, I would assume this should be a function
 * but currently, this isn't implemented in the prisma adapter.
 */
type PolicyCheck<RawAdapter extends PrismaClient> = {
  // [K in ModelNameOf<RawAdapter>]: (db: RawAdapter, row: RawAdapter[K]) => Promise<any>;
  [K in ModelNameOf<RawAdapter>]: Prisma.Args<RawAdapter[K], 'findMany'>['where']
};

export function prismaAdapter<RawAdapter extends PrismaClient>(
  prisma: RawAdapter,
): Adapter<RawAdapter, ModelNameOf<RawAdapter>, PolicyFilter<RawAdapter>, PolicyCheck<RawAdapter>> {

  // get all model names by filtering out Prisma client methods
  const models = Object.keys(Object(prisma)).filter(
    (key) =>
      !key.startsWith("_") && !key.startsWith("$") && key !== "constructor",
  ) as ModelNameOf<RawAdapter>[];

  const applyProxy = (
    raw: PrismaClient,
    ctx: any,
    policy: Policy<ModelNameOf<RawAdapter>, any, PolicyFilter<RawAdapter>, PolicyCheck<RawAdapter>>,
    _table?: ModelNameOf<RawAdapter>,
  ) => {
    return new Proxy(raw as any, {
      get(target, prop, receiver) {
        if (prop === "then") return undefined;
        if (prop === Symbol.for("nodejs.util.inspect.custom"))
          return () => "[GK Builder]";

        if (models.includes(prop as ModelNameOf<RawAdapter>)) {
          return applyProxy(
            (raw as any)[prop as string],
            ctx,
            policy,
            prop as ModelNameOf<RawAdapter>,
          );
        }

        const val = Reflect.get(target, prop, receiver);
        if (
          typeof val === "function" &&
          ATTACH_METHODS.includes(prop as string)
        ) {
          return async (...args: any[]) => {
            if (!_table) {
              throw new Error("Table not specified");
            }

            // Check if a policy exists for this table
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const p = policy[_table]!(ctx).insert?.check;
            if (!p) {
              return await val.apply(target, args);
            }

            if (
              [
                "findMany",
                "findFirst",
                "findUnique",
                "sum",
                "min",
                "max",
                "count",
              ].includes(prop as string)
            ) {
              args[0] = {
                ...args[0],
                where: {
                  ...args[0].where,
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  ...(_table ? policy[_table]!(ctx).select?.filter || {} : {}),
                },
              };
            }

            if (["create", "createMany"].includes(prop as string)) {
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              const p = policy[_table]!(ctx).insert?.check;
              if (p) {
              }
            }

            const result = await val.apply(target, args);

            console.log("← result from", prop, ":", result); // <── this prints the data
            return result;
          };
        }
        return val;
      },
    });
  };

  return {
    name: "prisma",
    raw: prisma,
    applyProxy: (raw, ctx, policy) => applyProxy(raw, ctx, policy, undefined),
    tableNames: models,
  };
}
