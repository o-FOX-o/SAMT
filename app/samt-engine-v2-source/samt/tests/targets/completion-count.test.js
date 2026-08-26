import test from "node:test";
import assert from "node:assert/strict";
import { aggregateLogsUnique } from "../../js/domain/logs.js";

test("Completion Count counts completed activity rather than every partial log", () => {
  const logs = [
    { id: "partial", actionId: "reading", completionMethodSnapshot: "time", completionTargetSnapshot: 30, durationMinutes: 10, timestamp: "2026-08-24T08:00:00.000Z" },
    { id: "complete", actionId: "reading", completionMethodSnapshot: "time", completionTargetSnapshot: 30, durationMinutes: 30, timestamp: "2026-08-24T09:00:00.000Z" },
    { id: "run-complete", actionId: "reading", completionCount: 2, completionMethodSnapshot: "time", completionTargetSnapshot: 30, durationMinutes: 5, timestamp: "2026-08-24T10:00:00.000Z" }
  ];
  assert.equal(aggregateLogsUnique(logs, { metric: "completion_count" }).actual, 2);
});
