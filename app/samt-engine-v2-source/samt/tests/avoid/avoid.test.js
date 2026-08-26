import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAvoidValue, interpolateAvoidScore } from "../../js/domain/avoid.js";

test("binary limit includes its boundary", () => {
  const config = { mode: "binary_limit", metric: "time", binaryLimit: 240, period: { mode: "week" } };
  assert.equal(evaluateAvoidValue(239, config).status, "success");
  assert.equal(evaluateAvoidValue(240, config).status, "success");
  assert.equal(evaluateAvoidValue(241, config).status, "failed");
});

test("scored range uses exact piecewise anchor interpolation", () => {
  const config = { mode: "scored_range", metric: "time", anchors: [{ value: 0, score: 200 }, { value: 120, score: 100 }, { value: 360, score: 0 }, { value: 540, score: -25 }], period: { mode: "week" } };
  assert.equal(interpolateAvoidScore(0, config), 200);
  assert.equal(interpolateAvoidScore(120, config), 100);
  assert.equal(interpolateAvoidScore(240, config), 50);
  assert.equal(interpolateAvoidScore(360, config), 0);
  assert.equal(interpolateAvoidScore(540, config), -25);
});

test("violation multiplier never caps failure load", () => {
  const config = { mode: "violation_multiplier", metric: "count", allowedCount: 0, violationPenalty: 100, period: { mode: "day" } };
  assert.equal(evaluateAvoidValue(0, config).status, "success");
  assert.equal(evaluateAvoidValue(1, config).failureLoad, 100);
  assert.equal(evaluateAvoidValue(2, config).failureLoad, 200);
  assert.equal(evaluateAvoidValue(3, config).failureLoad, 300);
});
