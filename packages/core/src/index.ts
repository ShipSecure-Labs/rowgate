import type { StandardSchemaV1 } from "@standard-schema/spec";
import { standardValidate } from "./schema";

export type Adapter<
  RawAdapter,
  Table extends string,
  PolicyFilter extends Record<Table, any>,
> = {
  name: string;
  raw: RawAdapter;
  tableNames: readonly Table[];
  applyProxy?: (
    raw: RawAdapter,
    ctx: any,
    policy: Policy<Table, any, PolicyFilter>,
    validate: (ctx: any) => Promise<any>,
  ) => RawAdapter;
};

export type Policy<
  Table extends string,
  Context,
  PolicyFilter extends Record<Table, any>,
> = {
  [K in Table]?: (ctx: Context) => {
    select?: {
      filter: PolicyFilter[K];
    };
    insert?: {
      check: Record<string, unknown>;
    };
    update?: {
      filter: PolicyFilter[K];
      check: Record<string, unknown>;
    };
    delete?: {
      filter: PolicyFilter[K];
    };
  };
};

export function withRowgate<
  RawAdapter,
  Table extends string,
  PolicyFilter extends Record<Table, any>,
  Schema extends StandardSchemaV1,
>(options: {
  adapter: Adapter<RawAdapter, Table, PolicyFilter>;
  context: Schema;
  policy: Policy<Table, StandardSchemaV1.InferInput<Schema>, PolicyFilter>;
}) {
  return {
    with(ctx: StandardSchemaV1.InferInput<Schema>): RawAdapter {
      if (!options.adapter.applyProxy) {
        throw new Error(`Adapter ${options.adapter.name} not implemented yet`);
      }

      return options.adapter.applyProxy(
        options.adapter.raw,
        ctx,
        options.policy,
        async (ctx: any) => {
          return await standardValidate(options.context, ctx);
        },
      );
    },
    system(): RawAdapter {
      return options.adapter.raw;
    },
  };
}
