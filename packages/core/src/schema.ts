import type { StandardSchemaV1 } from "@standard-schema/spec";
import { RowGateContextError, RowGateNotSupportedError } from "./errors";

export function standardValidate<T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>,
): StandardSchemaV1.InferOutput<T> {
  let result = schema["~standard"].validate(input);

  if (result instanceof Promise)
    throw new RowGateNotSupportedError(
      "Please choose a validation library which is synchronous (e.g. zod). Async context validation is not supported.",
    );

  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new RowGateContextError("Context schema validation failed", {
      issues: result.issues,
    });
  }

  return result.value;
}
