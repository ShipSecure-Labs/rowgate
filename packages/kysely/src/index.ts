import { Adapter, Policy, RowGatePolicyError } from "@rowgate/core";
export * from "@rowgate/core";

import {
  Kysely,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
} from "kysely";

/**
 * Extract table names from the DB type.
 */
type TableNameOf<DB> = Extract<keyof DB, string>;

/**
 * For Kysely, the policy filter is a function that takes a query builder
 * and returns a filtered query builder.
 */
type PolicyFilter<DB> = {
  [K in TableNameOf<DB>]: (
    qb: SelectQueryBuilder<DB, K, any>,
  ) => SelectQueryBuilder<DB, K, any>;
};

/**
 * For Kysely, the policy check is a function that takes a query builder, row
 * and returns a filtered query builder.
 */
type PolicyCheck<DB> = {
  [K in TableNameOf<DB>]: (db: Kysely<DB>, row: DB[K]) => Promise<any>;
};

export function kyselyAdapter<DB>(
  db: Kysely<DB>,
): Adapter<Kysely<DB>, TableNameOf<DB>, PolicyFilter<DB>, PolicyCheck<DB>> {
  // Table names come from the DB generic.
  // At runtime Kysely doesn't expose schema, so this is type-only.
  const tableNames = [] as TableNameOf<DB>[];

  const wrapExecute = <T extends object>(
    builder: T,
    beforeExecute: (method: string, args: any[]) => Promise<void> | void,
  ) =>
    new Proxy(builder as any, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (typeof val !== "function") return val;

        // Intercept common execution methods to run checks
        const EXEC_METHODS = [
          "execute",
          "executeTakeFirst",
          "executeTakeFirstOrThrow",
          "run",
          "stream",
        ];

        if (EXEC_METHODS.includes(prop as string)) {
          return async (...args: any[]) => {
            await beforeExecute(prop as string, args);
            return val.apply(target, args);
          };
        }

        return val;
      },
    });

  const applyProxy = (
    raw: any,
    ctx: any,
    policy: Policy<TableNameOf<DB>, any, PolicyFilter<DB>, PolicyCheck<DB>>,
    // currently unused, but kept for future async context validation
    _validate: (ctx: any) => Promise<any>,
  ) => {
    return new Proxy(raw as any, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);

        // Avoid Promise-like detection issues
        if (prop === "then") return undefined;
        if (prop === Symbol.for("nodejs.util.inspect.custom"))
          return () => "[Kysely Rowgate Adapter]";
        /**
         * SUBQUERIES INSIDE .select((eb) => [...])
         *
         * We don't duplicate selectFrom logic. Instead we just:
         * - wrap the ExpressionBuilder `eb` with `applyProxy`
         * - so that any `eb.selectFrom(...)` goes through the same
         *   selectFrom handler as top-level queries.
         */
        if (prop === "select" && typeof val === "function") {
          return (...args: any[]) => {
            // Function-style select: `.select((eb) => [...])`
            if (typeof args[0] === "function") {
              const userCb = args[0] as (eb: any) => any;

              const wrappedCb = (eb: any) => {
                // IMPORTANT: reuse applyProxy on the ExpressionBuilder.
                // This means eb.selectFrom(...) will hit the *same*
                // selectFrom handler defined below, with all the policy logic.
                const proxiedEb = applyProxy(eb, ctx, policy, _validate);
                return userCb(proxiedEb);
              };

              const qb = val.call(
                target,
                wrappedCb,
                ...args.slice(1),
              ) as SelectQueryBuilder<DB, any, any>;

              // And of course, proxy the resulting query builder as well.
              return applyProxy(qb, ctx, policy, _validate);
            }

            // Non-callback `.select(...)` → just proxy the resulting QB.
            const qb = val.call(target, ...args) as SelectQueryBuilder<
              DB,
              any,
              any
            >;
            return applyProxy(qb, ctx, policy, _validate);
          };
        }

        /**
         * SELECT
         */
        if (prop === "selectFrom" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            table: TB | TB[],
          ): SelectQueryBuilder<DB, TB, any> => {
            const qb = val.call(target, table) as SelectQueryBuilder<
              DB,
              TB,
              any
            >;

            const tables = Array.isArray(table) ? table : [table];

            let qbRes = qb;
            for (const t of tables) {
              const tablePolicyFactory = policy[t];
              if (!tablePolicyFactory) continue;

              const p = tablePolicyFactory(ctx);
              const filter = p.select?.filter ?? undefined;
              if (filter) {
                qbRes = filter(qbRes as any) as any;
              }
            }

            return applyProxy(qbRes, ctx, policy, _validate);
          };
        }

        /**
         * INSERT
         *
         * Enforce insert.check by intercepting `.values(...)`.
         */
        if (prop === "insertInto" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            table: TB,
          ): InsertQueryBuilder<DB, TB, any> => {
            const qb = val.call(target, table) as InsertQueryBuilder<
              DB,
              TB,
              any
            >;

            const tablePolicyFactory = policy[table];
            if (!tablePolicyFactory) {
              // No policy for this table → just proxy normally.
              return applyProxy(qb, ctx, policy, _validate);
            }

            const p = tablePolicyFactory(ctx);
            const check = p.insert?.check;

            if (!check) {
              // No check defined → normal behavior.
              return applyProxy(qb, ctx, policy, _validate);
            }

            // Wrap the builder to hook `.values(...)`
            const wrapped = new Proxy(qb as any, {
              get(qbTarget, qbProp, qbReceiver) {
                const original = Reflect.get(qbTarget, qbProp, qbReceiver);

                if (qbProp === "values" && typeof original === "function") {
                  return (values: any) => {
                    const nextQb = original.call(qbTarget, values);
                    return wrapExecute(nextQb, async () => {
                      try {
                        const checkRes = await check(raw, values);
                        if (!checkRes) throw new Error();
                      } catch {
                        throw new RowGatePolicyError(
                          `Policy check failed for "${table}"`,
                        );
                      }
                    });
                  };
                }

                if (typeof original === "function") {
                  return original.bind(qbTarget);
                }

                return original;
              },
            });

            return wrapped as InsertQueryBuilder<DB, TB, any>;
          };
        }

        /**
         * DELETE
         */
        if (prop === "deleteFrom" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            table: TB | TB[],
          ): DeleteQueryBuilder<DB, TB, any> => {
            const qb = val.call(target, table) as DeleteQueryBuilder<
              DB,
              TB,
              any
            >;

            const tables = Array.isArray(table) ? table : [table];

            let qbRes = qb;
            for (const t of tables) {
              const tablePolicyFactory = policy[t];
              if (!tablePolicyFactory) continue;

              const p = tablePolicyFactory(ctx);
              const filter = p.delete?.filter ?? undefined;

              if (!filter) {
                continue;
              }

              qbRes = filter(qbRes as any) as any;
            }

            return applyProxy(qbRes, ctx, policy, _validate);
          };
        }

        /**
         * UPDATE
         *
         * - apply update.filter
         * - enforce update.check by intercepting `.set(...)`
         */
        if (prop === "updateTable" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            table: TB,
          ): SelectQueryBuilder<DB, TB, any> => {
            const qb = val.call(target, table) as SelectQueryBuilder<
              DB,
              TB,
              any
            >;

            const tablePolicyFactory = policy[table];
            if (!tablePolicyFactory) {
              return applyProxy(qb, ctx, policy, _validate);
            }

            const p = tablePolicyFactory(ctx);
            const filter = p.update?.filter ?? undefined;
            const check = p.update?.check;

            const filteredQb = filter ? filter(qb) : qb;

            if (!check) {
              return applyProxy(filteredQb, ctx, policy, _validate);
            }

            // Wrap to hook `.set(...)`
            const wrapped = new Proxy(filteredQb as any, {
              get(qbTarget, qbProp, qbReceiver) {
                const original = Reflect.get(qbTarget, qbProp, qbReceiver);

                if (qbProp === "set" && typeof original === "function") {
                  return (values: any) => {
                    const nextQb = original.call(qbTarget, values);
                    return wrapExecute(nextQb, async () => {
                      try {
                        const checkRes = await check(raw, values);
                        if (!checkRes) throw new Error();
                      } catch {
                        throw new RowGatePolicyError(
                          `Policy check failed for "${table}"`,
                        );
                      }
                    });
                  };
                }

                if (typeof original === "function") {
                  return original.bind(qbTarget);
                }

                return original;
              },
            });

            return wrapped as SelectQueryBuilder<DB, TB, any>;
          };
        }

        /**
         * JOINS
         *
         * For now we only apply select filters on joined tables.
         */
        if (
          [
            "innerJoin",
            "leftJoin",
            "fullJoin",
            "rightJoin",
            "crossJoin",
            "innerJoinLateral",
            "leftJoinLateral",
            "crossJoinLateral",
          ].includes(String(prop)) &&
          typeof val === "function"
        ) {
          return <TB extends TableNameOf<DB>>(
            ...args: any[]
          ): SelectQueryBuilder<DB, TB, any> => {
            const qb = val.call(target, ...args) as SelectQueryBuilder<
              DB,
              TB,
              any
            >;

            const joinTable = args[0] as TB;

            const tablePolicyFactory = policy[joinTable];
            if (!tablePolicyFactory) {
              return applyProxy(qb, ctx, policy, _validate);
            }

            const p = tablePolicyFactory(ctx);
            const filter = p.select?.filter ?? undefined;

            const qbRes = filter ? (filter(qb as any) as any) : qb;
            return applyProxy(qbRes, ctx, policy, _validate);
          };
        }

        if (typeof val === "function") {
          return val.bind(target);
        }

        return val;
      },
    });
  };

  return {
    name: "kysely",
    raw: db,
    applyProxy,
    tableNames,
  };
}
