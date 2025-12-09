export type RowGateOperation = "select" | "insert" | "update" | "delete";

export class RowGateError extends Error {
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(message: string, code: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = "RowGateError";
    this.code = code;
    this.meta = meta;
  }
}

export class RowGateContextError extends RowGateError {
  constructor(
    message = "Invalid or missing RowGate context",
    meta?: Record<string, unknown>,
  ) {
    super(message, "ROWGATE_CONTEXT_ERROR", meta);
    this.name = "RowGateContextError";
  }
}

export class RowGatePolicyError extends RowGateError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, "ROWGATE_POLICY_ERROR", meta);
    this.name = "RowGatePolicyError";
  }
}

export class RowGateNotSupportedError extends RowGateError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, "ROWGATE_NOT_SUPPORTED_ERROR", meta);
    this.name = "RowGateNotSupportedError";
  }
}

export class RowGateAdapterError extends RowGateError {
  constructor(message: string, meta?: Record<string, unknown>) {
    super(message, "ROWGATE_ADAPTER_ERROR", meta);
    this.name = "RowGateAdapterError";
  }
}
