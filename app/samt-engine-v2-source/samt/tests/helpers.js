import { createEmptyState } from "../js/import-export/migrations.js";

export function stateAt(now = "2026-08-24T08:00:00.000Z") { return createEmptyState(now, "Europe/London"); }

export function action(id, name, method = "time", direction = "do") {
  return { id, name, description: "", tagIds: [], direction, completion: method === "time" ? { method: "time", minimumMinutes: 0, target: 0 } : { method: "quantity", target: 1, minimumMinutes: 0 }, result: { mode: "none", scoreMax: null, unitId: null, allowedUnitIds: [] }, status: "active", createdAt: "2026-08-24T08:00:00.000Z", updatedAt: "2026-08-24T08:00:00.000Z" };
}

export function relationship(id, kind, refId, extra = {}) { return { id, kind, refId, ...extra }; }

export function block(id, name, type, children = [], typeConfig = {}, direction = "do") {
  return { id, name, type, description: "", direction, children, completion: { mode: ["action_list", "collection"].includes(type) ? "open" : "manual", threshold: 0, requiredRelIds: [], afterThreshold: "allow_extra" }, typeConfig, projectTargets: [], status: "active", createdAt: "2026-08-24T08:00:00.000Z", updatedAt: "2026-08-24T08:00:00.000Z" };
}

export function deterministicIds() { let value = 0; return (prefix) => `${prefix}_test_${++value}`; }
