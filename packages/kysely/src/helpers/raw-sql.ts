import { RowGateNotSupportedError } from "@rowgate/core";

// Detect Kysely `sql` fragments by looking for RawNode ASTs
function containsRawSqlNode(value: any): boolean {
  if (value == null) return false;

  // If this looks like a Kysely expression, try to inspect its node
  if (typeof value.toOperationNode === "function") {
    try {
      const node = value.toOperationNode();
      if (node && node.node && node.node.kind === "RawNode") {
        if (
          node.node.sqlFragments.length == 3 &&
          node.node.sqlFragments.join("|") ===
            "(select json_object(|) from | as obj)"
        ) {
          // this is the special case for the `json_object/json_array` function
          // which should not be blocked by rowgate
          // These functions are proxied correctly
        } else {
          return true;
        }
      }
    } catch {
      // If this blows up for some weird expression, just ignore and keep walking.
    }
  }

  if (Array.isArray(value)) {
    return value.some((v) => containsRawSqlNode(v));
  }

  if (typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (containsRawSqlNode((value as any)[k])) return true;
    }
  }

  return false;
}

export function assertNoSqlFragments(args: any[]): void {
  if (containsRawSqlNode(args)) {
    throw new RowGateNotSupportedError(
      "RowGate does not support raw SQL fragments (`sql` tagged templates). " +
        "If you need raw SQL, use `db.ungated()` instead.",
    );
  }
}
