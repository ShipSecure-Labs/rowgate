import { Adapter, Policy } from "@rowgate/core";
export { withRowgate } from "@rowgate/core";
import { PrismaClient } from "@prisma/client";

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

type ModelNameOf<Client extends PrismaClient> =
  Extract<keyof Client, string> extends infer K extends string
    ? K extends `$${string}`
      ? never
      : K
    : never;

export function prismaAdapter<RawAdapter extends PrismaClient>(
  prisma: RawAdapter,
): Adapter<RawAdapter, ModelNameOf<RawAdapter>> {
  const models = Object.keys(Object(prisma)).filter(
    (key) =>
      !key.startsWith("_") && !key.startsWith("$") && key !== "constructor",
  );
  const applyProxy = (
    raw: RawAdapter,
    ctx: any,
    policy: Policy<ModelNameOf<PrismaClient>, any>,
    _table?: ModelNameOf<PrismaClient>,
  ) => {
    return new Proxy(raw as any, {
      get(target, prop, receiver) {
        if (prop === "then") return undefined;
        if (prop === Symbol.for("nodejs.util.inspect.custom"))
          return () => "[GK Builder]";

        if (models.includes(prop as string)) {
          return applyProxy(
            (raw as any)[prop as string],
            ctx,
            policy,
            prop as ModelNameOf<PrismaClient>,
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
            const p = policy[_table](ctx).insert?.check;
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
                  ...(_table ? policy[_table](ctx).select?.filter || {} : {}),
                },
              };
            }

            if (["create", "createMany"].includes(prop as string)) {
              const p = policy[_table](ctx).insert?.check;
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
    tableNames: models as ModelNameOf<RawAdapter>[],
  };
}
