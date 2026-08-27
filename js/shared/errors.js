/** Structured errors shared by the application layer and adapters. */
export class SamtError extends Error {
  constructor(message, code = "SAMT_ERROR", details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends SamtError {
  constructor(message, details = null) { super(message, "VALIDATION_ERROR", details); }
}
export class NotFoundError extends SamtError {
  constructor(message, details = null) { super(message, "NOT_FOUND", details); }
}
export class ConflictError extends SamtError {
  constructor(message, details = null) { super(message, "CONFLICT", details); }
}
export class CircularReferenceError extends SamtError {
  constructor(message, details = null) { super(message, "CIRCULAR_REFERENCE", details); }
}
export class InvalidScheduleError extends SamtError {
  constructor(message, details = null) { super(message, "INVALID_SCHEDULE", details); }
}
export class InvalidTargetError extends SamtError {
  constructor(message, details = null) { super(message, "INVALID_TARGET", details); }
}
export class InvalidAvoidEvaluationError extends SamtError {
  constructor(message, details = null) { super(message, "INVALID_AVOID_EVALUATION", details); }
}
export class StorageError extends SamtError {
  constructor(message, details = null) { super(message, "STORAGE_ERROR", details); }
}
export class ImportError extends SamtError {
  constructor(message, details = null) { super(message, "IMPORT_ERROR", details); }
}

export function assertCondition(condition, message, ErrorType = ValidationError, details = null) {
  if (!condition) throw new ErrorType(message, details);
}

export function success(value, events = []) { return { ok: true, value, events }; }
export function failure(error) {
  return { ok: false, error: error instanceof Error ? error : new SamtError(String(error)) };
}
