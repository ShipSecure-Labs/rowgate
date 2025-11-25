import { Adapter, Policy } from "@rowgate/core";
export { withRowgate } from "@rowgate/core";
import {
  Kysely,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  Expression,
} from "kysely";

/**
 * Extract table names from the DB type.
 */
type TableNameOf<DB> = Extract<keyof DB, string>;

/**
 * Expected Rowgate<->Kysely policy shape:
 * - select.filter: (eb) => Expression<boolean>
 * - insert.check: (values, ctx) => void | boolean | Promise<void|boolean>
 * - update.check: (values, ctx) => void | boolean | Promise<void|boolean>
 * - delete.check: (ctx) => void | boolean | Promise<void|boolean>
 *
 * If your Policy type differs, adapt the few call sites below.
 */

type PolicyFilter<DB> = {
  [K in TableNameOf<DB>]: (
    qb: SelectQueryBuilder<DB, K, any>,
  ) => SelectQueryBuilder<DB, K, any>;
};

export function kyselyAdapter<DB>(
  db: Kysely<DB>,
): Adapter<Kysely<DB>, TableNameOf<DB>, PolicyFilter<DB>> {
  // Table names come from the DB generic.
  // At runtime Kysely doesn't expose schema, so this is type-only.
  const tableNames = [] as TableNameOf<DB>[];

  const applyFilter = <TB extends TableNameOf<DB>>(
    qb: SelectQueryBuilder<DB, TB, any>,
    ctx: any,
    policy: Policy<TableNameOf<DB>, any, PolicyFilter<DB>>,
    table: TB,
  ) => {
    if (!policy[table]) return qb;
    const filter = policy[table](ctx).select?.filter ?? undefined;

    return filter ? filter(qb) : qb;
  };

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
    policy: Policy<TableNameOf<DB>, any, PolicyFilter<DB>>,
  ) => {
    return new Proxy(raw as any, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);

        // Avoid Promise-like detection issues
        if (prop === "then") return undefined;
        if (prop === Symbol.for("nodejs.util.inspect.custom"))
          return () => "[Kysely Rowgate Adapter]";

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
            for (const table of tables) {
              if (!policy[table]) continue;
              const filter = policy[table](ctx).select?.filter ?? undefined;
              if (filter) qbRes = filter(qbRes);
            }

            return applyProxy(qbRes, ctx, policy);
          };
        }

        /**
         * DELETE
         */
        if (prop === "deleteFrom" && typeof val === "function") {
          return <TB extends TableNameOf<DB>>(
            table: TB | TB[],
          ): DeleteQueryBuilder<DB, TB, any> => {
            const qb = val.call(target, table) as SelectQueryBuilder<
              DB,
              TB,
              any
            >;

            const tables = Array.isArray(table) ? table : [table];

            let qbRes = qb;
            for (const table of tables) {
              if (!policy[table]) continue;
              const filter = policy[table](ctx).delete?.filter ?? undefined;
              if (filter) qbRes = filter(qbRes);
            }

            return applyProxy(qbRes, ctx, policy);
          };
        }

        /**
         * UPDATE
         */
        if (
          ["updateTable"].includes(String(prop)) &&
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

            const table = args[0] as TB;

            if (!policy[table]) return qb;
            const filter = policy[table](ctx).update?.filter ?? undefined;
            return applyProxy(filter ? filter(qb) : qb, ctx, policy);
          };
        }

        /**
         * JOINS
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

            const table = args[0] as TB;

            if (!policy[table]) return qb;
            const filter = policy[table](ctx).select?.filter ?? undefined;
            return applyProxy(filter ? filter(qb) : qb, ctx, policy);
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
