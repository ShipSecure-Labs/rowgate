import {
  Adapter,
  Policy,
  RowGatePolicyError,
  RowGateNotSupportedError,
} from "@rowgate/core";
export * from "@rowgate/core";

import {
  Kysely,
  SelectQueryBuilder,
  InsertQueryBuilder,
  DeleteQueryBuilder,
} from "kysely";
import { parsePossibleTableAlias } from "./helpers/table-alias";
import { assertNoSqlFragments } from "./helpers/raw-sql";

const EXEC_METHODS = [
  "execute",
  "executeTakeFirst",
  "executeTakeFirstOrThrow",
  "run",
  "stream",
];

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
    table: K,
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

  const applyProxy = (
    raw: any,
    policy: Policy<TableNameOf<DB>, PolicyFilter<DB>, PolicyCheck<DB>>,
    _preExecute: (() => Promise<void> | void)[],
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
            assertNoSqlFragments(args);

            // Function-style select: `.select((eb) => [...])`
            if (typeof args[0] === "function") {
              const userCb = args[0] as (eb: any) => any;

              const wrappedCb = (eb: any) => {
                // IMPORTANT: reuse applyProxy on the ExpressionBuilder.
                const proxiedEb = applyProxy(eb, policy, _preExecute);
                const result = userCb(proxiedEb);
                // Ensure no sql fragments are returned from the callback either
                assertNoSqlFragments([result]);
                return result;
              };

              const qb = val.call(
                target,
                wrappedCb,
                ...args.slice(1),
              ) as SelectQueryBuilder<DB, any, any>;

              // Proxy the resulting query builder as well.
              return applyProxy(qb, policy, _preExecute);
            }

            // Non-callback `.select(...)` → just proxy the resulting QB.
            const qb = val.call(target, ...args) as SelectQueryBuilder<
              DB,
              any,
              any
            >;
            return applyProxy(qb, policy, _preExecute);
          };
        }

        /**
         * TRANSACTIONS
         */
        if (prop === "transaction" && typeof val === "function") {
          // `val` is the original db.transaction method
          return (...args: any[]) => {
            assertNoSqlFragments(args);

            // Get the original TransactionBuilder from Kysely
            const txBuilder = val.apply(target, args) as any;

            // Wrap the TransactionBuilder so we can intercept `.execute`
            const wrappedTxBuilder = new Proxy(txBuilder, {
              get(txTarget, txProp, txReceiver) {
                const original = Reflect.get(txTarget, txProp, txReceiver);

                // Intercept only the `execute` method of the TransactionBuilder
                if (txProp === "execute" && typeof original === "function") {
                  // `cb` is the user callback: (trx) => { ... }
                  return async (cb: (trx: any) => any) => {
                    for (const cb of _preExecute) {
                      await cb();
                    }

                    // Call the original .execute, but wrap the trx it passes in
                    return original.call(txTarget, (rawTrx: any) => {
                      // IMPORTANT: gate the transaction connection itself
                      const gatedTrx = applyProxy(rawTrx, policy, []);

                      // Call user callback with gated trx
                      return cb(gatedTrx);
                    });
                  };
                }

                if (typeof original === "function") {
                  return original.bind(txTarget);
                }

                return original;
              },
            });

            return wrappedTxBuilder;
          };
        }

        /**
         * MANUAL TRANSACTIONS via startTransaction()
         */
        if (prop === "startTransaction" && typeof val === "function") {
          // `val` is db.startTransaction
          return (...args: any[]) => {
            assertNoSqlFragments(args);

            // This is a ControlledTransactionBuilder
            const txBuilder = val.apply(target, args) as any;

            return new Proxy(txBuilder, {
              get(txTarget, txProp, txReceiver) {
                const original = Reflect.get(txTarget, txProp, txReceiver);

                // Only `execute()` matters on the builder
                if (txProp === "execute" && typeof original === "function") {
                  return async (...execArgs: any[]) => {
                    assertNoSqlFragments(execArgs);

                    // Run any pre-execute hooks that were collected on the db
                    for (const cb of _preExecute) {
                      await cb();
                    }

                    // Get the raw ControlledTransaction from Kysely
                    const rawTrx = await original.apply(txTarget, execArgs);

                    // IMPORTANT: wrap the transaction connection itself
                    // so that all queries inside trx go through RowGate.
                    const gatedTrx = applyProxy(rawTrx, policy, []);

                    return gatedTrx;
                  };
                }

                if (typeof original === "function") {
                  return original.bind(txTarget);
                }

                return original;
              },
            });
          };
        }

        /**
         * SAVEPOINTS
         */
        if (prop === "savepoint" && typeof val === "function") {
          // `val` is trx.savepoint
          return (...args: any[]) => {
            assertNoSqlFragments(args);

            // This is a builder with .execute() that returns a (sub)transaction
            const txBuilder = val.apply(target, args) as any;

            return new Proxy(txBuilder, {
              get(txTarget, txProp, txReceiver) {
                const original = Reflect.get(txTarget, txProp, txReceiver);

                // Intercept the builder's execute()
                if (txProp === "execute" && typeof original === "function") {
                  return async (...execArgs: any[]) => {
                    assertNoSqlFragments(execArgs);

                    // Run any pre-execute hooks attached to the *outer* trx/db
                    for (const cb of _preExecute) {
                      await cb();
                    }

                    // Get the raw (sub)transaction from Kysely
                    const rawTrx = await original.apply(txTarget, execArgs);

                    // Gate the savepoint transaction as well
                    const gatedTrx = applyProxy(rawTrx, policy, []);

                    return gatedTrx;
                  };
                }

                if (typeof original === "function") {
                  return original.bind(txTarget);
                }

                return original;
              },
            });
          };
        }

        /**
         * SELECT
         */
        if (prop === "selectFrom" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            table: TB | TB[],
          ): SelectQueryBuilder<DB, TB, any> => {
            assertNoSqlFragments([table]);

            const qb = val.call(target, table) as SelectQueryBuilder<
              DB,
              TB,
              any
            >;

            const tables = Array.isArray(table) ? table : [table];

            let qbRes = qb;
            for (const t of tables) {
              const { table, runtimeTable } = parsePossibleTableAlias(t);
              const tablePolicy = policy[table];
              if (!tablePolicy) continue;

              const filter = tablePolicy.select?.filter ?? undefined;
              if (filter) {
                qbRes = filter(qbRes as any, runtimeTable) as any;
              }
            }

            return applyProxy(qbRes, policy, _preExecute);
          };
        }

        /**
         * WITH (CTEs)
         * Syntax is like .with("name", (qb) => qb.selectFrom(...))
         * Call applyProxy on args[1]
         */
        if (prop === "with" && typeof val === "function") {
          return (...args: any[]) => {
            assertNoSqlFragments(args);

            if (typeof args[1] === "function") {
              const originalFactory = args[1];

              args[1] = (qb: any) => {
                // ensure anything the user does inside the factory is also gated
                const proxiedQb = applyProxy(qb, policy, _preExecute);
                const expression = originalFactory(proxiedQb);
                assertNoSqlFragments([expression]);
                return expression;
              };
            }

            const result = val.apply(target, args);
            // Make sure the resulting query builder is still gated
            return applyProxy(result, policy, _preExecute);
          };
        }

        /**
         * INSERT
         *
         * Enforce insert.check by intercepting `.values(...)`.
         */
        if (prop === "insertInto" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            t: TB,
          ): InsertQueryBuilder<DB, TB, any> => {
            assertNoSqlFragments([t]);

            const qb = val.call(target, t) as InsertQueryBuilder<DB, TB, any>;
            const { table } = parsePossibleTableAlias(t);

            const tablePolicy = policy[table];
            if (!tablePolicy) {
              // No policy for this table → just proxy normally.
              return applyProxy(qb, policy, _preExecute);
            }

            const check = tablePolicy.insert?.check;

            if (!check) {
              // No check defined → normal behavior.
              return applyProxy(qb, policy, _preExecute);
            }

            // Wrap the builder to hook `.values(...)`
            const wrapped = new Proxy(qb as any, {
              get(qbTarget, qbProp, qbReceiver) {
                const original = Reflect.get(qbTarget, qbProp, qbReceiver);

                if (qbProp == "columns" || qbProp == "expression") {
                  throw new RowGateNotSupportedError(
                    `RowGate does not support ".expression(...)" for inserts. Please use ".ungated()" if you need expressions.`,
                  );
                }

                if (qbProp === "values" && typeof original === "function") {
                  return (values: any) => {
                    assertNoSqlFragments([values]);

                    const nextQb = original.call(qbTarget, values);
                    return applyProxy(nextQb, policy, [
                      ..._preExecute,
                      async () => {
                        const rows = Array.isArray(values) ? values : [values];
                        for (const row of rows) {
                          const ok = await check(db, row);
                          if (!ok)
                            throw new RowGatePolicyError(
                              `Policy check failed for "${table}"`,
                            );
                        }
                      },
                    ]);
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
            assertNoSqlFragments([table]);

            const qb = val.call(target, table) as DeleteQueryBuilder<
              DB,
              TB,
              any
            >;

            const tables = Array.isArray(table) ? table : [table];

            let qbRes = qb;
            for (const t of tables) {
              const { table, runtimeTable } = parsePossibleTableAlias(t);
              const tablePolicy = policy[table];
              if (!tablePolicy) continue;

              const filter = tablePolicy.delete?.filter ?? undefined;

              if (!filter) {
                continue;
              }

              qbRes = filter(qbRes as any, runtimeTable) as any;
            }

            return applyProxy(qbRes, policy, _preExecute);
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
            t: TB,
          ): SelectQueryBuilder<DB, TB, any> => {
            assertNoSqlFragments([t]);

            const qb = val.call(target, t) as SelectQueryBuilder<DB, TB, any>;
            const { table, runtimeTable } = parsePossibleTableAlias(t);

            const tablePolicy = policy[table];
            if (!tablePolicy) {
              return applyProxy(qb, policy, _preExecute);
            }

            const filter = tablePolicy.update?.filter ?? undefined;
            const check = tablePolicy.update?.check;

            const filteredQb = filter ? filter(qb, runtimeTable) : qb;

            if (!check) {
              return applyProxy(filteredQb, policy, _preExecute);
            }

            // Wrap to hook `.set(...)`
            const wrapped = new Proxy(filteredQb as any, {
              get(qbTarget, qbProp, qbReceiver) {
                const original = Reflect.get(qbTarget, qbProp, qbReceiver);

                if (qbProp === "set" && typeof original === "function") {
                  return (values: any) => {
                    assertNoSqlFragments([values]);

                    const nextQb = original.call(qbTarget, values);

                    return applyProxy(nextQb, policy, [
                      ..._preExecute,
                      async () => {
                        const ok = await check(db, values);
                        if (!ok)
                          throw new RowGatePolicyError(
                            `Policy check failed for "${table}"`,
                          );
                      },
                    ]);
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
            assertNoSqlFragments(args);

            const qb = val.call(target, ...args) as SelectQueryBuilder<
              DB,
              TB,
              any
            >;

            const joinTable = args[0] as TB;
            const { table, runtimeTable } = parsePossibleTableAlias(joinTable);

            const tablePolicy = policy[table];
            if (!tablePolicy) {
              return applyProxy(qb, policy, _preExecute);
            }

            const filter = tablePolicy.select?.filter ?? undefined;

            const qbRes = filter
              ? (filter(qb as any, runtimeTable) as any)
              : qb;
            return applyProxy(qbRes, policy, _preExecute);
          };
        }

        if (EXEC_METHODS.includes(prop as string)) {
          return async (...args: any[]) => {
            assertNoSqlFragments(args);

            for (const cb of _preExecute) {
              await cb();
            }
            return val.apply(target, args);
          };
        }

        if (typeof val === "function") {
          return (...args: any[]) => {
            assertNoSqlFragments(args);

            const result = val.call(target, ...args) as any;

            // If the result is a Promise or promise-like, return it directly.
            // Don't wrap promises in applyProxy as it breaks the promise chain
            // (applyProxy returns undefined for .then, making promises non-awaitable).
            if (result && typeof result.then === "function") {
              return result;
            }

            // Otherwise, wrap the query builder result in applyProxy
            return applyProxy(result, policy, _preExecute);
          };
        }

        return val;
      },
    });
  };

  return {
    name: "kysely",
    raw: db,
    applyProxy: (raw, policy) => {
      return applyProxy(raw, policy, []);
    },
    tableNames,
  };
}
