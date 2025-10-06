export type Adapter<RawAdapter, Table extends string> = {
  name: string;
  raw: RawAdapter;
  tableNames: readonly Table[];
  applyProxy?: (
    raw: RawAdapter,
    ctx: any,
    policy: Policy<Table, any>,
  ) => RawAdapter;
};

export type Policy<Table extends string, Context> = {
  [K in Table]: (ctx: Context) => {
    where?: Record<string, unknown>;
  };
};

export function withGatekeeper<
  RawAdapter,
  Table extends string,
  Context,
>(options: {
  adapter: Adapter<RawAdapter, Table>;
  policy: Policy<Table, Context>;
}) {
  assertPolicyCoversAll(
    options.adapter.tableNames,
    options.policy,
    options.adapter.name,
  );

  return {
    with(ctx: Context): RawAdapter {
      if (!options.adapter.applyProxy) {
        throw new Error(`Adapter ${options.adapter.name} not implemented yet`);
      }
      return options.adapter.applyProxy(
        options.adapter.raw,
        ctx,
        options.policy,
      );
    },
    without(): RawAdapter {
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
      `Gatekeeper(${adapterName}): policy missing entries for tables: ${missing.join(", ")}`,
    );
  }
}
