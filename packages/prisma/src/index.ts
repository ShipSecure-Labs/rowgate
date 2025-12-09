/* eslint-disable @typescript-eslint/no-unused-vars */
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
): Adapter<RawAdapter, ModelNameOf<RawAdapter>, any, any> {
  const models = Object.keys(Object(prisma)).filter(
    (key) =>
      !key.startsWith("_") && !key.startsWith("$") && key !== "constructor",
  );

  return {
    name: "prisma",
    raw: prisma,
    applyProxy: (raw, _) => {
      return raw;
    },
    tableNames: models as ModelNameOf<RawAdapter>[],
  };
}
