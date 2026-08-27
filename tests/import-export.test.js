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
