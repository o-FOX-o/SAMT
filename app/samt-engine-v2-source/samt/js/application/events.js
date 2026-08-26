export const EVENTS = Object.freeze({
  ACTION_LOGGED: "ACTION_LOGGED",
  ACTION_LOG_UPDATED: "ACTION_LOG_UPDATED",
  ACTION_LOG_DELETED: "ACTION_LOG_DELETED",
  RUN_STARTED: "RUN_STARTED",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_PAUSED: "RUN_PAUSED",
  RUN_RESUMED: "RUN_RESUMED",
  OCCURRENCE_CREATED: "OCCURRENCE_CREATED",
  OCCURRENCE_COMPLETED: "OCCURRENCE_COMPLETED",
  OCCURRENCE_MISSED: "OCCURRENCE_MISSED",
  PERIOD_OPENED: "PERIOD_OPENED",
  PERIOD_CLOSED: "PERIOD_CLOSED",
  TARGET_REACHED: "TARGET_REACHED",
  AVOID_FAILED: "AVOID_FAILED",
  CYCLE_ADVANCED: "CYCLE_ADVANCED",
  BLOCK_ACTIVATED: "BLOCK_ACTIVATED",
  BLOCK_PAUSED: "BLOCK_PAUSED",
  IMPORT_PERFORMED: "IMPORT_PERFORMED",
  IMPORT_UNDONE: "IMPORT_UNDONE"
});

export function domainEvent(type, payload, occurredAt) { return { type, payload, occurredAt }; }

export class EventCollector {
  constructor() { this.events = []; }
  emit(event) { this.events.push(event); return event; }
  drain() { const events = [...this.events]; this.events.length = 0; return events; }
}

export class StructuredLogger {
  constructor(enabled = false, sink = console) { this.enabled = enabled; this.sink = sink; }
  debug(scope, message, details = null) { if (this.enabled) this.sink.debug(`[${scope}] ${message}`, details || ""); }
  info(scope, message, details = null) { if (this.enabled) this.sink.info(`[${scope}] ${message}`, details || ""); }
  error(scope, message, details = null) { this.sink.error(`[${scope}] ${message}`, details || ""); }
}
