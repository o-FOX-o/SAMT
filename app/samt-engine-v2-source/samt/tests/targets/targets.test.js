import test from "node:test";
import assert from "node:assert/strict";
import { calculateTargetProgress } from "../../js/domain/targets.js";
import { stateAt, action, block, relationship } from "../helpers.js";

test("weekly target preserves overachievement", () => {
  const state = stateAt();
  state.actions.push(action("a_workout", "Workout Action"));
  state.blocks.push(block("b_workout", "Workout", "target", [relationship("r_workout", "action", "a_workout")], { targetMetric: "time", targetValue: 360, targetUnit: "minutes", period: { mode: "week", weekStart: 1 }, aggregation: "inclusive_unique" }));
  state.actionLogs.push({ id: "log_7h", actionId: "a_workout", timestamp: "2026-08-24T10:00:00.000Z", durationPerformed: 420 });
  const result = calculateTargetProgress({ state, block: state.blocks[0], now: "2026-08-24T12:00:00.000Z", timezone: "Europe/London" });
  assert.equal(result.actual, 420);
  assert.equal(result.percentage, 116.67);
  assert.equal(result.over, 60);
});

test("nested child targets remain independent", () => {
  const state = stateAt();
  state.actions.push(action("a_combat", "Combat"), action("a_muscle", "Muscle Action"));
  state.blocks.push(
    block("b_muscle", "Muscle", "target", [relationship("r_muscle", "action", "a_muscle")], { targetMetric: "time", targetValue: 180, period: { mode: "week" }, aggregation: "inclusive_unique" }),
    block("b_workout", "Workout", "target", [relationship("r_combat", "action", "a_combat"), relationship("r_child", "block", "b_muscle")], { targetMetric: "time", targetValue: 360, period: { mode: "week" }, aggregation: "inclusive_unique" })
  );
  state.actionLogs.push({ id: "log_combat", actionId: "a_combat", timestamp: "2026-08-24T10:00:00.000Z", durationPerformed: 360 });
  const workout = calculateTargetProgress({ state, block: state.blocks[1], now: "2026-08-24T12:00:00.000Z", timezone: "Europe/London" });
  const muscle = calculateTargetProgress({ state, block: state.blocks[0], now: "2026-08-24T12:00:00.000Z", timezone: "Europe/London", closed: true });
  assert.equal(workout.reached, true);
  assert.equal(muscle.actual, 0);
  assert.equal(muscle.status, "missed");
});

test("per-session Target opens, aggregates factual logs and closes", async () => {
  const { SamtEngine } = await import("../../js/application/engine.js");
  const { FakeClock } = await import("../../js/infrastructure/clock.js");
  const { MemoryRepository } = await import("../../js/infrastructure/repository.js");
  const { deterministicIds } = await import("../helpers.js");
  const state = stateAt("2026-08-24T08:00:00.000Z");
  state.actions.push(action("bench", "Bench Press"));
  state.blocks.push(block("chest", "Chest Training", "target", [relationship("rel_bench", "action", "bench")], { targetMetric: "time", targetValue: 45, targetUnit: "minutes", period: { mode: "session" }, aggregation: "inclusive_unique", requireChildTargets: false, requiredChildBlockIds: [] }));
  const clock = new FakeClock("2026-08-24T08:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds() });
  await engine.initialize();
  const period = await engine.startPeriod("chest");
  clock.advanceMinutes(30);
  await engine.logAction("bench", { durationPerformed: 47 });
  const openProgress = engine.queries.getTargetProgress("chest");
  assert.equal(openProgress.actual, 47);
  assert.equal(openProgress.status, "over_target");
  await engine.closePeriod(period.value.id);
  const closed = engine.queries.getState().targetPeriods[0];
  assert.equal(closed.actual, 47);
  assert.equal(closed.status, "over_target");
  assert.ok(closed.closedAt);
});
