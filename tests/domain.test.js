import test from "node:test";
import assert from "node:assert/strict";
import { createAction, isActionCompletionAchieved } from "../js/domain/actions.js";
import { createResultField, validateResultValues, analyzeResultValues } from "../js/domain/results.js";
import { BUILTIN_UNITS, convertValue } from "../js/domain/units.js";
import { createActionLog, aggregateLogsUnique } from "../js/domain/logs.js";
import { createTargetConfig, calculateTargetProgress } from "../js/domain/targets.js";
import { evaluateAvoidPeriod } from "../js/domain/avoid.js";
import { generateSmallCycle, createBigCycleRuntime, generateNextSmallCycle, recordCycleResolution } from "../js/domain/cycles.js";
import { createOccurrence, resolveOccurrenceStatus } from "../js/domain/occurrences.js";
import { calculatePeriodBounds } from "../js/shared/dates.js";

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

test("outcome Targets compare structured Results without summing measurements", () => {
  const field = createResultField({ id: "result_body_weight", type: "measurement", label: "Body Weight", config: { defaultUnitId: "unit_kg", allowedUnitIds: ["unit_kg", "unit_g"] }, now });
  const action = createAction({ id: "action_weight", name: "Weigh In", resultFields: [field], now }, { units: BUILTIN_UNITS });
  const first = createActionLog({ id: "log_weight_1", action, eventAt: "2026-01-01T08:00:00Z", resultValues: [{ fieldId: field.id, value: { value: 72000, unitId: "unit_g" } }], now, units: BUILTIN_UNITS });
  const second = createActionLog({ id: "log_weight_2", action, eventAt: "2026-01-02T08:00:00Z", resultValues: [{ fieldId: field.id, value: { value: 71, unitId: "unit_kg" } }], now, units: BUILTIN_UNITS });
  const target = { id: "target_weight", config: createTargetConfig({ mode: "outcome", sourceActionIds: [action.id], sourceResultFieldId: field.id, aggregation: "latest", comparison: "<=", targetValue: 70, unitId: "unit_kg" }) };
  const progress = calculateTargetProgress({ target, logs: [first, second], resultField: field, units: BUILTIN_UNITS });
  assert.equal(progress.actual, 71); assert.equal(progress.reached, false); assert.equal(progress.analysis.count, 2);
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

test("multiple factual logs can complete one occurrence without merging logs", () => {
  const action = createAction({ id: "action_split", name: "Mandarin", completion: { method: "time", minimumMinutes: 15 }, now });
  const occurrence = createOccurrence({ id: "occ_split", relationshipId: "rel_split", deadline: "2026-01-01T23:59:00Z", logIds: ["log_a", "log_b"], now });
  const logs = [{ id: "log_a", durationMinutes: 8 }, { id: "log_b", durationMinutes: 7 }];
  assert.equal(resolveOccurrenceStatus({ occurrence, logs, action, now }).toString(), "completed");
  assert.equal(logs.length, 2);
});

test("period bounds use explicit local timezone and distinguish rolling windows", () => {
  const calendar = calculatePeriodBounds({ period: "day", at: "2026-03-29T01:30:00Z", timezone: "Europe/London" });
  const rolling = calculatePeriodBounds({ period: "week", style: "rolling", at: "2026-03-29T12:00:00Z", timezone: "Europe/London" });
  assert.equal(new Date(calendar.start).toISOString(), "2026-03-29T00:00:00.000Z");
  assert.equal(Math.round((new Date(rolling.end) - new Date(rolling.start)) / 3600000), 168);
});
