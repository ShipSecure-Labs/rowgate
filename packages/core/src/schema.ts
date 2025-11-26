import type { StandardSchemaV1 } from "@standard-schema/spec";
import { RowGateContextError } from "./errors";

export async function standardValidate<T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>,
): Promise<StandardSchemaV1.InferOutput<T>> {
  let result = schema["~standard"].validate(input);
  if (result instanceof Promise) result = await result;

  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new RowGateContextError("Context schema validation failed", {
      issues: result.issues,
    });
  }

  return result.value;
}
