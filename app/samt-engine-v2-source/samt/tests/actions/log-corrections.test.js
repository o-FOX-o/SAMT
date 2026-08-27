import test from "node:test";
import assert from "node:assert/strict";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { aggregateLogsUnique } from "../../js/domain/logs.js";
import { action, block, deterministicIds, relationship, stateAt } from "../helpers.js";

test("partial logs complete one Occurrence once and corrections recalculate it", async () => {
  const state = stateAt();
  const reading = action("reading", "Reading");
  reading.completion = { method: "time", minimumMinutes: 30, target: 30 };
  state.actions.push(reading);
  state.blocks.push(block("reading_list", "Reading List", "action_list", [relationship("reading_rel", "action", "reading")]));
  state.occurrences.push({
    id: "reading_occurrence",
    actionId: "reading",
    actionNameSnapshot: "Reading",
    parentBlockId: "reading_list",
    blockNameSnapshot: "Reading List",
    relationshipId: "reading_rel",
    relationshipSnapshot: { id: "reading_rel", kind: "action", refId: "reading" },
    completionSnapshot: { method: "time", minimumMinutes: 30, target: 30 },
    availableAt: "2026-08-24T00:00:00.000Z",
    dueAt: "2026-08-25T00:00:00.000Z",
    expiryPolicy: "expire",
    status: "due",
    actionLogIds: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z"
  });
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock: new FakeClock("2026-08-24T10:00:00.000Z"), idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();

  const first = await engine.logAction("reading", { durationPerformed: 15 });
  const second = await engine.logAction("reading", { durationPerformed: 15 });
  assert.equal(engine.queries.getState().occurrences[0].actual, 30);
  assert.equal(engine.queries.getState().occurrences[0].status, "completed");
  assert.equal(aggregateLogsUnique(engine.queries.getState().actionLogs, { metric: "completion_count" }).actual, 1);

  await engine.updateActionLog(second.value.id, { durationPerformed: 10 });
  assert.equal(engine.queries.getState().occurrences[0].actual, 25);
  assert.equal(engine.queries.getState().occurrences[0].status, "partial");
  assert.equal(aggregateLogsUnique(engine.queries.getState().actionLogs, { metric: "completion_count" }).actual, 0);

  await engine.deleteActionLog(first.value.id);
  assert.equal(engine.queries.getState().occurrences[0].actual, 10);
  assert.equal(engine.queries.getState().history.at(-1).event, "action_log_deleted");
});

test("a backdated factual log uses its event time and keeps a separate recorded time", async () => {
  const state = stateAt();
  state.actions.push(action("study", "Study"));
  state.blocks.push(block("study_list", "Study List", "action_list", [relationship("study_rel", "action", "study")]));
  state.occurrences.push({ id: "study_occurrence", actionId: "study", actionNameSnapshot: "Study", parentBlockId: "study_list", relationshipId: "study_rel", availableAt: "2026-08-23T08:00:00.000Z", dueAt: "2026-08-23T20:00:00.000Z", expiryPolicy: "carry_forward", status: "overdue", actionLogIds: [], createdAt: "2026-08-23T08:00:00.000Z", updatedAt: "2026-08-23T08:00:00.000Z" });
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock: new FakeClock("2026-08-24T10:00:00.000Z"), idFactory: deterministicIds() });
  await engine.initialize();
  const result = await engine.logAction("study", { durationPerformed: 20, timestamp: "2026-08-23T10:00:00.000Z" });
  assert.equal(result.value.timestamp, "2026-08-23T10:00:00.000Z");
  assert.deepEqual(result.value.linkedOccurrenceIds, ["study_occurrence"]);
  const history = engine.queries.getState().history.at(-1);
  assert.equal(history.timestamp, "2026-08-23T10:00:00.000Z");
  assert.equal(history.recordedAt, "2026-08-24T10:00:00.000Z");
});
