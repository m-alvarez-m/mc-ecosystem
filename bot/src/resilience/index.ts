// Barrel del subsistema de resiliencia (ADR-013).

export { retryWithBackoff, computeDelayMs } from "./retry.js";
export type { RetryOptions, RetryResult, RetryFailure } from "./retry.js";

export { CircuitBreaker } from "./circuit-breaker.js";
export type { CircuitBreakerOptions } from "./circuit-breaker.js";

export { classifyError, summarizeErrorMessage } from "./error-classifier.js";

export { StructuredErrorLogger } from "./structured-error-logger.js";
export type { StructuredErrorFields, Sink } from "./structured-error-logger.js";

export { DlqClient } from "./dlq-client.js";
export type { DlqClientOptions, DlqInsertRequest } from "./dlq-client.js";

export { DlqMonitor } from "./dlq-monitor.js";
export type { DlqMonitorOptions } from "./dlq-monitor.js";

export { ResilientExecutor, DlqWriteFailedError } from "./resilient-executor.js";
export type { ResilientExecutorOptions, ExecuteResult } from "./resilient-executor.js";

export type { ErrorType, CircuitState, DlqReason } from "./types.js";
