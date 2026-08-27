import test from "node:test";
import assert from "node:assert/strict";
import { createAction } from "../js/domain/actions.js";
import { createActionLog } from "../js/domain/logs.js";
import { createResultField, validateResultFields, validateResultValues } from "../js/domain/results.js";
import { createBlock } from "../js/domain/blocks.js";
import { createRelationship, validateBlockGraph } from "../js/domain/relationships.js";
import { createTargetConfig, calculateTargetProgress } from "../js/domain/targets.js";
import { BUILTIN_UNITS } from "../js/domain/units.js";
import { generateSmallCycle } from "../js/domain/cycles.js";

const now = new Date("2026-01-01T10:00:00Z");

test("required result fields reject empty multiple-choice values and measurement bounds convert units", () => {
  const choice = createResultField({ id: "result_choice_required", type: "choice", label: "Choice", required: true, config: { mode: "multiple", minSelections: 0, options: [{ id: "one", label: "One" }] }, now });
  assert.throws(() => validateResultValues({ fields: [choice], resultValues: [{ fieldId: choice.id, value: [] }], finalizing: true }));
  const measurement = createResultField({ id: "result_mass", type: "measurement", label: "Mass", config: { defaultUnitId: "unit_kg", min: 70, max: 80 }, now });
  validateResultFields([measurement], BUILTIN_UNITS);
  assert.throws(() => validateResultValues({ fields: [measurement], resultValues: [{ fieldId: measurement.id, value: { value: 69000, unitId: "unit_g" } }], units: BUILTIN_UNITS, finalizing: false }));
});

test("contextual duplicate Action relationships are allowed but identical labels are not", () => {
  const action = createAction({ id: "action_brush", name: "Brush Teeth", now });
  const first = createBlock({ id: "block_habits", type: "routine", name: "Habits", relationships: [{ id: "rel_morning", parentBlockId: "block_habits", kind: "action", refId: action.id, label: "Morning", position: 0 }], now });
  const second = { ...first, relationships: [...first.relationships, { id: "rel_evening", parentBlockId: first.id, kind: "action", refId: action.id, label: "Evening", position: 1 }] };
  assert.doesNotThrow(() => validateBlockGraph({ blocks: [second], actions: [action] }));
  const duplicateLabel = { ...second, relationships: [...second.relationships, { id: "rel_morning_2", parentBlockId: first.id, kind: "action", refId: action.id, label: "Morning", position: 2 }] };
  assert.throws(() => validateBlockGraph({ blocks: [duplicateLabel], actions: [action] }));
});

test("inclusive Target derives descendant Blocks and still counts a factual log once", () => {
  const action = createAction({ id: "action_study", name: "Study", now });
  const child = createBlock({ id: "block_child", type: "collection", name: "Child", relationships: [{ id: "rel_child_action", parentBlockId: "block_child", kind: "action", refId: action.id }], now });
  const parent = createBlock({ id: "block_parent", type: "target", name: "Parent", relationships: [{ id: "rel_parent_child", parentBlockId: "block_parent", kind: "block", refId: child.id }], config: createTargetConfig({ sourceBlockId: "block_parent", contributionScope: "inclusive", targetValue: 30 }), now });
  const log = createActionLog({ id: "log_study", action, durationMinutes: 30, eventAt: now, contextRefs: [{ blockId: child.id }, { blockId: parent.id }], now });
  const progress = calculateTargetProgress({ target: parent, blocks: [parent, child], logs: [log, { ...log, contextRefs: [{ blockId: parent.id }] }], actions: [action] });
  assert.equal(progress.actual, 30);
  assert.equal(progress.reached, true);
});

test("cycle config fields normalize frequency and retain deterministic snapshots", () => {
  const cycle = generateSmallCycle({ relationships: [{ id: "a", config: { appearanceMode: "fixed", frequency: 2 } }, { id: "b", config: { appearanceMode: "fixed", frequency: 1 } }], now });
  assert.deepEqual(cycle.slots.map((slot) => slot.relationshipId), ["a", "b", "a"]);
  assert.equal(cycle.relationshipSnapshot.a.fixedCount, 2);
});
