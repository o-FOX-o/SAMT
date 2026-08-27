import test from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../js/infrastructure/clock.js";
import { memoryRepository } from "../js/infrastructure/repository.js";
import { createEmptyState, migrateV2State } from "../js/application/normalization.js";
import { createEngine } from "../js/application/engine.js";
import { createAction } from "../js/domain/actions.js";
import { createBlock } from "../js/domain/blocks.js";
import { createRelationship } from "../js/domain/relationships.js";

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
  assert.equal(repository.getState().actions[0].resultFields.length, 2); assert.equal(repository.getState().tags[0].id, tag.id); assert.equal(repository.getState().units.some((item) => item.id === unit.id), true);
});

test("blocked local storage is not fatal and empty state is valid", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const clock = fakeClock(new Date("2026-01-01T10:00:00Z"));
  const engine = createEngine({ storage: blocked, clock });
  assert.ok(engine.getState().actions);
  assert.doesNotThrow(() => engine.reconcile());
});

test("V2 migration preserves IDs, logs and legacy source metadata", () => {
  const migrated = migrateV2State({ schemaVersion: "2.0.0", categories: [{ id: "category_old", name: "Learning", status: "active" }], actions: [{ id: "action_old", name: "Study", categoryId: "category_old", polarity: "positive", recurrence: {} }], blocks: [{ id: "block_old", name: "Study Block", actionIds: ["action_old"], status: "active" }], cycles: [], projects: [], actionTasks: [], quickTasks: [], reviews: [], actionLogs: [{ id: "log_old", actionId: "action_old", eventAt: "2026-01-01T10:00:00Z", durationMinutes: 10 }], history: [{ id: "history_old", timestamp: "2026-01-01T10:00:00Z", description: "old" }] }, { now: new Date("2026-01-02T00:00:00Z") });
  assert.equal(migrated.actions[0].id, "action_old"); assert.equal(migrated.blocks[0].id, "block_old"); assert.equal(migrated.actionLogs[0].id, "log_old"); assert.equal(migrated.history[0].id, "history_old"); assert.equal(migrated.legacy.sourceSchemaVersion, "2.0.0");
});
