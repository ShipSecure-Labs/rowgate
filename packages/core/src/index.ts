import type { StandardSchemaV1 } from "@standard-schema/spec";
import { standardValidate } from "./schema";

export type Adapter<RawAdapter, Table extends string> = {
  name: string;
  raw: RawAdapter;
  tableNames: readonly Table[];
  applyProxy?: (
    raw: RawAdapter,
    ctx: any,
    policy: Policy<Table, any>,
    validate: (ctx: any) => Promise<any>,
  ) => RawAdapter;
};

export type Policy<Table extends string, Context> = {
  [K in Table]: (ctx: Context) => {
    select?: {
      filter: Record<string, unknown>;
    };
    insert?: {
      check: Record<string, unknown>;
    };
    update?: {
      filter: Record<string, unknown>;
      check: Record<string, unknown>;
    };
    delete?: {
      filter: Record<string, unknown>;
    };
  };
};

export function withRowgate<
  RawAdapter,
  Table extends string,
  Schema extends StandardSchemaV1,
>(options: {
  adapter: Adapter<RawAdapter, Table>;
  context: Schema;
  policy: Policy<Table, StandardSchemaV1.InferInput<Schema>>;
}) {
  assertPolicyCoversAll(
    options.adapter.tableNames,
    options.policy,
    options.adapter.name,
  );

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

/** Runtime guard to ensure all tables have policy entries */
function assertPolicyCoversAll<Table extends string, Context>(
  tableNames: readonly Table[],
  policy: Policy<Table, Context>,
  adapterName: string,
): void {
  const missing = tableNames.filter(
    (t) => !(t in (policy as Record<string, unknown>)),
  );
  if (missing.length) {
    throw new Error(
      `RowGate(${adapterName}): policy missing entries for tables: ${missing.join(", ")}`,
    );
  }
}
