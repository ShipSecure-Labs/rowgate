import { RowGateCheckFailedError, RowGateOperation } from "./errors";

export function assertPolicyCheck(
  check: Record<string, unknown> | undefined,
  row: Record<string, unknown>,
  meta: {
    table: string;
    operation: RowGateOperation;
    policyName?: string;
  },
): void {
  if (!check) return;

  const mismatches: Record<string, { expected: unknown; actual: unknown }> = {};

  for (const [key, expected] of Object.entries(check)) {
    const actual = (row as any)[key];
    if (actual && actual !== expected) {
      mismatches[key] = { expected, actual };
    }
  }

  if (Object.keys(mismatches).length > 0) {
    throw new RowGateCheckFailedError(
      `RowGate check failed for ${meta.operation.toUpperCase()} on "${meta.table}".`,
      {
        ...meta,
        mismatches,
      },
    );
  }
}
