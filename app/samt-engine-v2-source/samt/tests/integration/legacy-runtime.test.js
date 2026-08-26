import test from "node:test";
import assert from "node:assert/strict";
import { SamtEngine } from "../../js/application/engine.js";
import { getRunningRuns } from "../../js/application/selectors.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { createEmptyState } from "../../js/import-export/migrations.js";
import { deterministicIds } from "../helpers.js";

test("legacy Runs, Occurrences, logs and calendar schedules remain live", async () => {
  const now = "2026-08-26T10:00:00.000Z";
  const state = createEmptyState("2026-08-20T10:00:00.000Z", "Europe/London");
  state.internalStorageVersion = 1;
  state.actions.push({ id: "action_legacy", name: "Legacy Focus", direction: "do", tagIds: [], completion: { method: "time", target: 30 }, result: { mode: "none" }, status: "active", createdAt: now, updatedAt: now });
  state.blocks.push({
    id: "block_legacy", name: "Legacy List", type: "action_list", direction: "do", status: "active", description: "",
    completion: { mode: "open", requiredRelIds: [] }, typeConfig: {}, projectTargets: [], createdAt: now, updatedAt: now,
    children: [{ id: "rel_legacy", kind: "action", refId: "action_legacy", schedule: { mode: "calendar", calendar: { mode: "daily", weekdays: [], dates: [], time: "00:00" }, deadline: { mode: "relative", amount: 1, unit: "days" }, unfinishedPolicy: "expire" } }]
  });
  state.actionLogs.push({ id: "log_old", actionId: "action_legacy", actionNameSnapshot: "Legacy Focus", timestamp: "2026-08-26T09:00:00.000Z", durationMinutes: 10, quantity: 0, createdAt: "2026-08-26T09:00:00.000Z" });
  state.occurrences.push({ id: "occurrence_old", blockId: "block_legacy", blockNameSnapshot: "Legacy List", relationshipId: "rel_legacy", actionId: "action_legacy", actionNameSnapshot: "Legacy Focus", availableAt: "2026-08-25T23:00:00.000Z", deadlineAt: "2026-08-26T23:00:00.000Z", status: "partial", durationMinutesActual: 10, quantityActual: 0, logIds: ["log_old"], createdAt: now, updatedAt: now });
  state.runs.push({ id: "run_old", blockId: "block_legacy", blockNameSnapshot: "Legacy List", status: "active", logIds: ["log_old"], createdAt: now, updatedAt: now });

  const repository = new MemoryRepository(state);
  const engine = new SamtEngine({ repository, clock: new FakeClock(now), timezone: "Europe/London", idFactory: deterministicIds() });
  await engine.initialize();
  const migrated = engine.queries.getState();
  assert.equal(migrated.actions[0].completion.minimumMinutes, 30);
  assert.equal(migrated.occurrences.length, 1, "reconciliation must not duplicate the existing daily occurrence");
  assert.equal(migrated.occurrences[0].dueAt, "2026-08-26T23:00:00.000Z");
  assert.deepEqual(migrated.occurrences[0].actionLogIds, ["log_old"]);
  assert.equal(getRunningRuns(migrated).length, 1);

  const logged = await engine.logAction("action_legacy", { durationPerformed: 20 });
  assert.deepEqual(logged.value.linkedRunIds, ["run_old"]);
  assert.deepEqual(logged.value.linkedOccurrenceIds, ["occurrence_old"]);
  const updated = engine.queries.getState().occurrences[0];
  assert.equal(updated.actual, 30);
  assert.equal(updated.status, "completed");
  assert.equal(updated.logIds.length, 2);
  assert.equal(repository.backups.length, 1, "initialisation creates an automatic pre-migration backup");
  assert.equal(repository.backups[0].runs[0].status, "active", "backup is the untouched legacy state");
});
