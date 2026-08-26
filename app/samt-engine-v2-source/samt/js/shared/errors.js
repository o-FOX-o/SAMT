export class SamtError extends Error {
  constructor(message, code = "SAMT_ERROR", details = null) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends SamtError {
  constructor(message, details) { super(message, "VALIDATION_ERROR", details); }
}
export class NotFoundError extends SamtError {
  constructor(message, details) { super(message, "NOT_FOUND", details); }
}
export class ConflictError extends SamtError {
  constructor(message, details) { super(message, "CONFLICT", details); }
}
export class CircularReferenceError extends SamtError {
  constructor(message, details) { super(message, "CIRCULAR_REFERENCE", details); }
}
export class InvalidScheduleError extends SamtError {
  constructor(message, details) { super(message, "INVALID_SCHEDULE", details); }
}
export class InvalidTargetError extends SamtError {
  constructor(message, details) { super(message, "INVALID_TARGET", details); }
}
export class InvalidAvoidEvaluationError extends SamtError {
  constructor(message, details) { super(message, "INVALID_AVOID_EVALUATION", details); }
}
export class StorageError extends SamtError {
  constructor(message, details) { super(message, "STORAGE_ERROR", details); }
}
export class ImportError extends SamtError {
  constructor(message, details) { super(message, "IMPORT_ERROR", details); }
}
