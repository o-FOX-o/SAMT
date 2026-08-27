import test from "node:test";
import assert from "node:assert/strict";
import { createAction, isActionCompletionAchieved } from "../js/domain/actions.js";
import { createResultField, validateResultValues, analyzeResultValues } from "../js/domain/results.js";
import { BUILTIN_UNITS, convertValue } from "../js/domain/units.js";
import { createActionLog, aggregateLogsUnique } from "../js/domain/logs.js";
import { createTargetConfig, calculateTargetProgress } from "../js/domain/targets.js";
import { evaluateAvoidPeriod } from "../js/domain/avoid.js";
import { generateSmallCycle, createBigCycleRuntime, generateNextSmallCycle, recordCycleResolution } from "../js/domain/cycles.js";

const now = new Date("2026-01-01T10:00:00Z");

test("Actions preserve over-target quantity and time minimum zero semantics", () => {
  const quantity = createAction({ id: "action_quantity", name: "Push Ups", completion: { method: "quantity", target: 20 }, now });
  assert.equal(isActionCompletionAchieved({ action: quantity, log: { quantity: 27 } }), true);
  assert.equal(isActionCompletionAchieved({ action: quantity, log: { quantity: 19 } }), false);
  const time = createAction({ id: "action_time", name: "Meditate", completion: { method: "time", minimumMinutes: 0 }, now });
  assert.equal(isActionCompletionAchieved({ action: time, log: { durationMinutes: 1 } }), true);
  assert.equal(isActionCompletionAchieved({ action: time, log: { durationMinutes: 0 } }), false);
});

test("Actions support up to ten result fields, duplicate types, required values and snapshots", () => {
  const fields = [
    createResultField({ id: "result_weight", type: "measurement", label: "Weight", required: true, config: { defaultUnitId: "unit_kg", allowedUnitIds: ["unit_kg", "unit_g"] }, now }),
    createResultField({ id: "result_waist", type: "measurement", label: "Waist", config: { defaultUnitId: "unit_cm", allowedUnitIds: ["unit_cm"] }, now }),
    createResultField({ id: "result_note", type: "text", label: "Note", config: { maxChars: 100 }, now })
  ];
  const action = createAction({ id: "action_results", name: "Check In", resultFields: fields, now }, { units: BUILTIN_UNITS });
  assert.equal(action.resultFields.length, 3);
  assert.throws(() => validateResultValues({ fields, resultValues: [], units: BUILTIN_UNITS, finalizing: true }));
  assert.doesNotThrow(() => validateResultValues({ fields, resultValues: [{ fieldId: "result_weight", value: { value: 72.4, unitId: "unit_kg" } }], units: BUILTIN_UNITS, finalizing: true }));
  assert.equal(analyzeResultValues({ field: fields[0], values: [{ value: 70, unitId: "unit_kg" }, { value: 71, unitId: "unit_kg" }], units: BUILTIN_UNITS }).average, 70.5);
  assert.equal(convertValue(1000, "unit_g", "unit_kg", BUILTIN_UNITS), 1);
});

test("one factual log remains one unique log across inclusive attribution", () => {
  const action = createAction({ id: "action_mandarin", name: "Mandarin", now });
  const log = createActionLog({ id: "log_one", action, durationMinutes: 30, eventAt: now, contextRefs: [{ blockId: "mandarin" }, { blockId: "languages" }, { blockId: "study" }], now });
  assert.equal(aggregateLogsUnique([log, { ...log, contextRefs: [{ blockId: "weekly" }] }]).length, 1);
  const target = { id: "target_week", type: "target", config: createTargetConfig({ metric: "time", targetValue: 3600, sourceActionIds: [action.id] }) };
  const progress = calculateTargetProgress({ target, logs: [log], period: null, actions: [action] });
  assert.equal(progress.actual, 30);
  assert.equal(progress.targetValue, 3600);
});

test("Avoid binary zero, multiplier and scored anchors", () => {
  assert.equal(evaluateAvoidPeriod({ mode: "binary_limit", actual: 0, allowed: 0 }).status, "SUCCESS");
  assert.equal(evaluateAvoidPeriod({ mode: "binary_limit", actual: 1, allowed: 0 }).status, "FAILED");
  assert.equal(evaluateAvoidPeriod({ mode: "violation_multiplier", violations: 3, allowed: 0, penaltyPercent: 100 }).failureLoad, 300);
  assert.equal(evaluateAvoidPeriod({ mode: "scored_range", actual: 240, anchors: [{ actual: 0, score: 200 }, { actual: 120, score: 100 }, { actual: 360, score: 0 }, { actual: 540, score: -25 }] }).score, 50);
});

test("weighted cycles are deterministic and big-cycle coverage is separate from completion", () => {
  const relationships = [
    { id: "a", appearanceMode: "weighted", weight: 10 }, { id: "b", appearanceMode: "weighted", weight: 7 },
    { id: "c", appearanceMode: "weighted", weight: 5 }, { id: "fixed", appearanceMode: "fixed", fixedCount: 1 }
  ];
  const first = generateSmallCycle({ relationships, size: 3, fairness: {}, now });
  const second = generateSmallCycle({ relationships, size: 3, fairness: {}, now });
  assert.deepEqual(first.slots, second.slots);
  const big = createBigCycleRuntime({ cycleId: "cycle", relationships, smallCycleSize: 3, now });
  const generated = generateNextSmallCycle({ bigCycle: big, relationships, now });
  const afterSkip = recordCycleResolution({ bigCycle: big, smallCycle: generated, relationshipId: generated.slots[0].relationshipId, outcome: "skipped" });
  assert.equal(afterSkip.completionCoverage.includes(generated.slots[0].relationshipId), false);
  assert.equal(afterSkip.appearanceCoverage.includes(generated.slots[0].relationshipId), true);
});
