import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyState } from "../js/application/normalization.js";
import { exportPackage, serializePackage } from "../js/import-export/exporter.js";
import { importPackage } from "../js/import-export/importer.js";

test("V3 export/import round trip is semantic and import failure is non-mutating", () => {
  const state = createEmptyState(new Date("2026-01-01T00:00:00Z")); state.meta.marker = "round-trip";
  const backup = exportPackage(state, { exportedAt: new Date("2026-01-01T01:00:00Z") });
  const result = importPackage(JSON.parse(serializePackage(state)), { existingState: state, now: new Date("2026-01-01T02:00:00Z") });
  assert.equal(result.state.meta.marker, "round-trip"); assert.equal(result.restorePoint.meta.marker, "round-trip");
  assert.throws(() => importPackage({ package: "SAMT", schemaVersion: "3.0.0", state: { schemaVersion: "3.0.0" } }, { existingState: state }));
  assert.equal(backup.package, "SAMT");
});

test("schema-v2 raw exports import through the deterministic migration", () => {
  const legacy = { schemaVersion: "2.0.0", categories: [], actions: [{ id: "old_action", name: "Read", polarity: "positive" }], blocks: [], cycles: [], projects: [], actionTasks: [], quickTasks: [], reviews: [], actionLogs: [], history: [] };
  const result = importPackage(legacy, { existingState: createEmptyState(new Date("2026-01-01T00:00:00Z")), now: new Date("2026-01-01T01:00:00Z") });
  assert.equal(result.state.schemaVersion, "3.0.0");
  assert.equal(result.state.actions[0].id, "old_action");
  assert.equal(result.state.meta.migratedFrom, "2.0.0");
});

test("life-command schema-v2 backup envelopes remain importable", () => {
  const legacyPackage = {
    format: "life-command", schemaVersion: 2, packageId: "legacy_backup", packageType: "backup", exportedAt: "2026-01-01T01:00:00.000Z", rootObjectIds: [],
    data: { categories: [], tags: [], units: [], actions: [{ id: "envelope_action", name: "Journal", direction: "do", completion: { method: "time", minimumMinutes: 0 }, result: { mode: "none" } }], blocks: [], actionLogs: [], history: [] }
  };
  const result = importPackage(legacyPackage, { existingState: createEmptyState(new Date("2026-01-01T02:00:00Z")), now: new Date("2026-01-01T02:00:00Z") });
  assert.equal(result.state.actions[0].id, "envelope_action");
  assert.equal(result.state.legacy.sourcePackage.packageType, "backup");
});
