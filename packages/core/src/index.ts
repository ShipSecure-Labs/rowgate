import type { StandardSchemaV1 } from "@standard-schema/spec";
import { standardValidate } from "./schema";
export * from "./errors";

export type Adapter<
  RawAdapter,
  Table extends string,
  PolicyFilter extends Record<Table, any>,
  PolicyCheck extends Record<Table, any>,
> = {
  name: string;
  raw: RawAdapter;
  tableNames: readonly Table[];
  applyProxy?: (
    raw: RawAdapter,
    policy: Policy<Table, PolicyFilter, PolicyCheck>,
    validate: (ctx: any) => Promise<any>,
  ) => RawAdapter;
};

export type Policy<
  Table extends string,
  PolicyFilter extends Record<Table, any>,
  PolicyCheck extends Record<Table, any>,
> = {
  [K in Table]?: {
    select?: {
      filter?: PolicyFilter[K];
    };
    insert?: {
      check?: PolicyCheck[K];
    };
    update?: {
      filter?: PolicyFilter[K];
      check?: PolicyCheck[K];
    };
    delete?: {
      filter?: PolicyFilter[K];
    };
  };
};

export function withRowgate<
  RawAdapter,
  Table extends string,
  PolicyFilter extends Record<Table, any>,
  PolicyCheck extends Record<Table, any>,
  Schema extends StandardSchemaV1,
>(options: {
  adapter: Adapter<RawAdapter, Table, PolicyFilter, PolicyCheck>;
  context: Schema;
  policy: (
    ctx: StandardSchemaV1.InferInput<Schema>,
  ) => Policy<Table, PolicyFilter, PolicyCheck>;
}) {
  return {
    gated(ctx: StandardSchemaV1.InferInput<Schema>): RawAdapter {
      if (!options.adapter.applyProxy) {
        throw new Error(`Adapter ${options.adapter.name} not implemented yet`);
      }

      return options.adapter.applyProxy(
        options.adapter.raw,
        options.policy(ctx),
        async (ctx: any) => {
          return await standardValidate(options.context, ctx);
        },
      );
    },
    ungated(): RawAdapter {
      return options.adapter.raw;
    },
  };
}
