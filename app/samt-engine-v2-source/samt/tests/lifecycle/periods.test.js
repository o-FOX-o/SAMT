import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { SamtEngine } from "../../js/application/engine.js";
import { stateAt, action, block, relationship, deterministicIds } from "../helpers.js";

test("daily Target closes missed and opens a zeroed next period", async () => {
  const state = stateAt();
  state.actions.push(action("a_mandarin", "Mandarin"));
  state.blocks.push(block("b_mandarin", "Mandarin Target", "target", [relationship("r_mandarin", "action", "a_mandarin")], { targetMetric: "time", targetValue: 15, period: { mode: "day" }, aggregation: "inclusive_unique" }));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  await engine.logAction("a_mandarin", { durationPerformed: 10 });
  clock.set("2026-08-25T00:30:00.000Z");
  await engine.reconcileTemporalState();
  const saved = engine.queries.getState();
  assert.equal(saved.actionLogs.length, 1);
  assert.equal(saved.targetPeriods.filter((item) => item.blockId === "b_mandarin").length, 2);
  assert.equal(saved.targetPeriods.find((item) => item.status === "missed").actual, 10);
  assert.equal(engine.queries.getTargetProgress("b_mandarin").actual, 0);
});

test("zero-limit Avoid period auto succeeds without fake Action Log", async () => {
  const state = stateAt();
  state.actions.push(action("a_gaming", "Gaming", "time", "avoid"));
  state.blocks.push(block("b_control", "Self Control", "target", [relationship("r_gaming", "action", "a_gaming")], { targetMetric: "time", targetValue: 1, period: { mode: "day" }, aggregation: "inclusive_unique", avoidEvaluation: { mode: "binary_limit", metric: "time", binaryLimit: 0, period: { mode: "day" } } }, "avoid"));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  clock.set("2026-08-25T00:30:00.000Z");
  await engine.reconcileTemporalState();
  const saved = engine.queries.getState();
  assert.equal(saved.actionLogs.length, 0);
  assert.equal(saved.avoidPeriods.find((item) => item.status === "success").actual, 0);
});

test("Avoid failure retains every factual log", async () => {
  const state = stateAt();
  state.actions.push(action("a_gaming", "Gaming", "time", "avoid"));
  state.blocks.push(block("b_control", "Gaming Control", "target", [relationship("r_gaming", "action", "a_gaming")], { targetMetric: "time", targetValue: 1, period: { mode: "day" }, aggregation: "inclusive_unique", avoidEvaluation: { mode: "binary_limit", metric: "time", binaryLimit: 0, period: { mode: "day" } } }, "avoid"));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  await engine.logAction("a_gaming", { durationPerformed: 5 });
  assert.equal(engine.queries.getAvoidStatus("b_control").status, "failed");
  assert.equal(engine.queries.getState().actionLogs.length, 1);
});
