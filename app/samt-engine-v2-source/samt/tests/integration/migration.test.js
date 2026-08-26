import test from "node:test";
import assert from "node:assert/strict";
import { migrateInternalState } from "../../js/import-export/migrations.js";

test("storage migration preserves IDs, counts, logs and History", () => {
  const old = {
    schemaVersion: "1.11.0", appVersion: "1.12.0", meta: { createdAt: "2026-08-01T00:00:00.000Z" }, settings: {},
    categories: [{ id: "category_one", name: "Work" }], tags: [], units: [],
    actions: [{ id: "action_one", name: "Deep Work", tagIds: [], completion: { method: "time", minimumMinutes: 30 }, result: { mode: "none" }, status: "active" }],
    blocks: [{ id: "block_one", name: "Work", type: "collection", children: [{ id: "rel_one", kind: "action", refId: "action_one" }], completion: { mode: "open", requiredRelIds: [] }, status: "active" }],
    activations: [], runs: [], actionLogs: [{ id: "log_one", actionId: "action_one", timestamp: "2026-08-02T10:00:00.000Z", durationPerformed: 30 }], history: [{ id: "history_one", type: "action_log" }], analysisTargets: [], styles: [], restorePoints: [], importHistory: []
  };
  const migrated = migrateInternalState(old, { now: "2026-08-26T10:00:00.000Z", timezone: "Europe/London" }).state;
  assert.equal(migrated.actions.length, old.actions.length);
  assert.equal(migrated.blocks.length, old.blocks.length);
  assert.equal(migrated.actionLogs.length, old.actionLogs.length);
  assert.equal(migrated.history.length, old.history.length);
  assert.equal(migrated.actions[0].id, "action_one");
  assert.equal(migrated.blocks[0].id, "block_one");
  assert.equal(migrated.actionLogs[0].id, "log_one");
});

test("fresh state is empty", async () => {
  const { createEmptyState } = await import("../../js/import-export/migrations.js");
  const state = createEmptyState("2026-08-26T10:00:00.000Z", "Europe/London");
  assert.equal(state.actions.length, 0);
  assert.equal(state.blocks.length, 0);
  assert.equal(state.categories.length, 0);
  assert.equal(state.actionLogs.length, 0);
});
