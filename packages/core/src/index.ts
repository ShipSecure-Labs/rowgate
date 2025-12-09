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

export type RowGateOptions = {
  disableContextValidation?: boolean;
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
  options?: RowGateOptions;
}) {
  return {
    gated(ctx: StandardSchemaV1.InferInput<Schema>): RawAdapter {
      if (!options.adapter.applyProxy) {
        throw new Error(`Adapter ${options.adapter.name} not implemented yet`);
      }

      let ctxRendered = ctx;
      if (!options.options?.disableContextValidation)
        ctxRendered = standardValidate(options.context, ctx);

      return options.adapter.applyProxy(
        options.adapter.raw,
        options.policy(ctxRendered),
      );
    },
    ungated(): RawAdapter {
      return options.adapter.raw;
    },
  };
}
