import test from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../js/infrastructure/clock.js";
import { memoryRepository } from "../js/infrastructure/repository.js";
import { createEmptyState, migrateV2State } from "../js/application/normalization.js";
import { createEngine } from "../js/application/engine.js";
import { createBrowserRepository, V3_BACKUP_KEY } from "../js/infrastructure/local-storage.js";
import { createAction } from "../js/domain/actions.js";
import { createBlock } from "../js/domain/blocks.js";
import { createRelationship } from "../js/domain/relationships.js";
import { returnToWorkflowStep } from "../js/domain/workflows.js";

test("commands use one transaction and snapshots while Home/Analysis stay queries", () => {
  const clock = fakeClock(new Date("2026-01-01T10:00:00Z"), "UTC");
  const state = createEmptyState(clock.now()); const repository = memoryRepository(state); const engine = createEngine({ repository, clock });
  const action = engine.commands.createAction({ id: "action_log", name: "Study", completion: { method: "time", minimumMinutes: 0 } });
  const block = engine.commands.createBlock({ id: "block_target", type: "target", name: "Study Target", definitionStatus: "ACTIVE", config: { mode: "accumulation", metric: "time", targetValue: 60, sourceActionIds: [action.id], period: "day" } });
  engine.commands.addRelationship(block.id, createRelationship({ parentBlockId: block.id, kind: "action", refId: action.id, id: "relationship_log", now: clock.now() }));
  const log = engine.commands.logAction({ actionId: action.id, durationMinutes: 30, eventAt: clock.now(), contextRefs: [{ blockId: block.id }] });
  assert.equal(repository.getState().actionLogs.length, 1);
  assert.equal(engine.queries.getAnalysisViewModel({ blockId: block.id }).totalMinutes, 30);
  assert.equal(engine.queries.getHomeViewModel({ timezone: "UTC" }).timezone, "UTC");
  assert.equal(log.actionSnapshot.name, "Study");
});

test("V3 builders add taxonomy, compatible Units, Actions and multiple Result Fields", () => {
  const clock = fakeClock(new Date("2026-01-01T10:00:00Z")); const repository = memoryRepository(createEmptyState(clock.now())); const engine = createEngine({ repository, clock });
  const category = engine.commands.createCategory({ id: "category_test", name: "Training", scope: "both" });
  const tag = engine.commands.createTag({ id: "tag_test", categoryId: category.id, name: "Strength", scope: "action" });
  const unit = engine.commands.createUnit({ id: "unit_test", name: "Rounds", symbol: "rnd", dimension: "count:rounds", factor: 1 });
  const action = engine.commands.createAction({ id: "action_test", name: "Boxing", tagIds: [tag.id], completion: { method: "quantity", target: 1 } });
  engine.commands.addResultField(action.id, { id: "result_one", type: "text", label: "Opponent" });
  engine.commands.addResultField(action.id, { id: "result_two", type: "measurement", label: "Rounds", config: { defaultUnitId: unit.id, allowedUnitIds: [unit.id] } });
  engine.commands.updateAction(action.id, { resultFields: repository.getState().actions[0].resultFields.map((field) => field.id === "result_one" ? { ...field, label: "Opponent Name" } : field) });
  assert.equal(repository.getState().actions[0].resultFields.length, 2); assert.equal(repository.getState().tags[0].id, tag.id); assert.equal(repository.getState().units.some((item) => item.id === unit.id), true);
  assert.equal(repository.getState().actions[0].resultFields.find((field) => field.id === "result_one").definitionVersion, 2);
});

test("blocked local storage is not fatal and empty state is valid", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const clock = fakeClock(new Date("2026-01-01T10:00:00Z"));
  const engine = createEngine({ storage: blocked, clock });
  assert.ok(engine.getState().actions);
  assert.doesNotThrow(() => engine.reconcile());
});

test("legacy storage migration creates a restore point before V3 writes", () => {
  const records = new Map(); const storage = { getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  records.set("life-command-progress-tracker-v2", JSON.stringify({ schemaVersion: "2.0.0", categories: [], actions: [], blocks: [], cycles: [], projects: [], actionTasks: [], quickTasks: [], reviews: [], actionLogs: [], history: [] }));
  const repository = createBrowserRepository({ storage, clock: new Date("2026-01-01T00:00:00Z") });
  assert.ok(repository.restorePoint); assert.ok(records.has(V3_BACKUP_KEY)); assert.equal(repository.getState().schemaVersion, "3.0.0");
});

test("V2 migration preserves IDs, logs and legacy source metadata", () => {
  const migrated = migrateV2State({ schemaVersion: "2.0.0", categories: [{ id: "category_old", name: "Learning", status: "active" }], actions: [{ id: "action_old", name: "Study", categoryId: "category_old", polarity: "positive", recurrence: {} }], blocks: [{ id: "block_old", name: "Study Block", actionIds: ["action_old"], status: "active" }], cycles: [], projects: [], actionTasks: [], quickTasks: [], reviews: [], actionLogs: [{ id: "log_old", actionId: "action_old", eventAt: "2026-01-01T10:00:00Z", durationMinutes: 10 }], history: [{ id: "history_old", timestamp: "2026-01-01T10:00:00Z", description: "old" }] }, { now: new Date("2026-01-02T00:00:00Z") });
  assert.equal(migrated.actions[0].id, "action_old"); assert.equal(migrated.blocks[0].id, "block_old"); assert.equal(migrated.actionLogs[0].id, "log_old"); assert.equal(migrated.history[0].id, "history_old"); assert.equal(migrated.legacy.sourceSchemaVersion, "2.0.0");
});

test("temporal reconciliation is idempotent and expires a daily occurrence at local midnight", () => {
  const clock = fakeClock(new Date("2026-01-01T10:00:00Z"), "UTC"); const state = createEmptyState(clock.now()); const repository = memoryRepository(state); const engine = createEngine({ repository, clock });
  const action = engine.commands.createAction({ id: "action_daily", name: "Prayer", completion: { method: "time", minimumMinutes: 0 } });
  const block = createBlock({ id: "block_daily", type: "action_list", name: "Daily List", definitionStatus: "ACTIVE", relationships: [{ id: "relationship_daily", parentBlockId: "block_daily", kind: "action", refId: action.id, position: 0, config: { schedule: { mode: "calendar", calendarKind: "daily", dateOnly: true }, unfinishedPolicy: "expire" } }], now: clock.now() });
  repository.saveBlock(block);
  assert.equal(engine.reconcile({ now: clock.now(), timezone: "UTC" }).created.length, 1);
  assert.equal(engine.reconcile({ now: clock.now(), timezone: "UTC" }).created.length, 0);
  clock.set("2026-01-02T10:00:00Z"); const next = engine.reconcile({ now: clock.now(), timezone: "UTC" });
  assert.equal(next.created.length, 1); assert.equal(repository.getState().occurrences.filter((item) => item.status === "missed").length, 1);
});

test("returning to a Workflow step reopens downstream steps without deleting history", () => {
  const steps = [{ id: "a", state: "COMPLETED" }, { id: "b", state: "COMPLETED" }, { id: "c", state: "COMPLETED" }];
  const returned = returnToWorkflowStep({ steps, stepId: "b", now: new Date("2026-01-03T00:00:00Z") });
  assert.deepEqual(returned.map((step) => step.state), ["COMPLETED", "AVAILABLE", "LOCKED"]);
  assert.equal(returned[2].reopenedFromState, "COMPLETED");
  assert.equal(steps[2].state, "COMPLETED");
});
