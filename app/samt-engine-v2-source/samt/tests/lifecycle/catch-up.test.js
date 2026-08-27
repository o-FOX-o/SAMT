import test from "node:test";
import assert from "node:assert/strict";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { action, block, deterministicIds, relationship, stateAt } from "../helpers.js";

test("daily Targets and zero-limit Avoid periods catch up every skipped window idempotently", async () => {
  const state = stateAt("2026-08-24T08:00:00.000Z");
  state.actions.push(action("mandarin", "Mandarin"), action("gaming", "Gaming", "time", "avoid"));
  state.blocks.push(
    block("mandarin_target", "Mandarin Target", "target", [relationship("mandarin_rel", "action", "mandarin")], { targetMetric: "time", targetValue: 15, period: { mode: "day" }, aggregation: "inclusive_unique" }),
    block("self_control", "Self Control", "action_list", [relationship("gaming_rel", "action", "gaming", { avoidEvaluation: { mode: "binary_limit", metric: "time", binaryLimit: 0, period: { mode: "day" } } })])
  );
  const clock = new FakeClock("2026-08-24T08:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  clock.set("2026-08-28T08:00:00.000Z");
  await engine.reconcileTemporalState();
  await engine.reconcileTemporalState();
  const saved = engine.queries.getState();
  assert.equal(saved.targetPeriods.filter((item) => item.blockId === "mandarin_target").length, 5);
  assert.equal(saved.targetPeriods.filter((item) => item.status === "missed").length, 4);
  assert.equal(saved.avoidPeriods.filter((item) => item.relationshipId === "gaming_rel").length, 5);
  assert.equal(saved.avoidPeriods.filter((item) => item.relationshipId === "gaming_rel" && item.status === "success").length, 4);
  assert.equal(saved.actionLogs.length, 0);
  assert.equal(saved.history.filter((item) => item.event === "target_period_closed").length, 4);
  assert.equal(saved.history.filter((item) => item.event === "avoid_period_closed").length, 4);
});

test("daily expiring Occurrences are generated and missed across an offline gap", async () => {
  const state = stateAt("2026-08-24T08:00:00.000Z");
  state.actions.push(action("fajr", "Fajr", "quantity"));
  state.blocks.push(block("daily_prayer", "Daily Prayer", "routine", [relationship("fajr_rel", "action", "fajr")], { suggestedRecurrence: "daily" }));
  const clock = new FakeClock("2026-08-24T08:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  clock.set("2026-08-28T08:00:00.000Z");
  await engine.reconcileTemporalState();
  await engine.reconcileTemporalState();
  const saved = engine.queries.getState();
  assert.equal(saved.occurrences.length, 5);
  assert.equal(saved.occurrences.filter((item) => item.status === "missed").length, 4);
  assert.equal(saved.history.filter((item) => item.event === "occurrence_missed").length, 4);
});

test("an open Target period keeps the definition and Action scope captured at period start", async () => {
  const state = stateAt();
  state.actions.push(action("old_action", "Old Action"), action("new_action", "New Action"));
  state.blocks.push(block("daily_target", "Daily Target", "target", [relationship("old_rel", "action", "old_action")], { targetMetric: "time", targetValue: 15, period: { mode: "day" }, aggregation: "inclusive_unique" }));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  await engine.logAction("old_action", { durationPerformed: 15 });
  await engine.updateBlock("daily_target", { children: [relationship("new_rel", "action", "new_action")], typeConfig: { targetMetric: "time", targetValue: 30, period: { mode: "day" }, aggregation: "inclusive_unique" } });
  const duringOriginalPeriod = engine.queries.getTargetProgress("daily_target");
  assert.equal(duringOriginalPeriod.target, 15);
  assert.equal(duringOriginalPeriod.actual, 15);
  assert.equal(duringOriginalPeriod.status, "target_reached");
  clock.set("2026-08-25T00:30:00.000Z");
  await engine.reconcileTemporalState();
  const periods = engine.queries.getState().targetPeriods;
  const closed = periods.find((item) => item.closedAt);
  const current = periods.find((item) => !item.closedAt);
  assert.equal(closed.targetSnapshot.targetValue, 15);
  assert.deepEqual(closed.actionIdsSnapshot, ["old_action"]);
  assert.equal(closed.status, "target_reached");
  assert.equal(current.targetSnapshot.targetValue, 30);
  assert.deepEqual(current.actionIdsSnapshot, ["new_action"]);
});

test("Cycle period close applies missed-item policy separately from period position policy", async () => {
  const state = stateAt();
  state.actions.push(action("chest", "Chest", "quantity"), action("back", "Back", "quantity"));
  state.blocks.push(block("training_cycle", "Training Cycle", "cycle", [relationship("chest_rel", "action", "chest"), relationship("back_rel", "action", "back")], {
    period: { mode: "day" },
    autoClose: true,
    positionPolicy: "continue",
    missedItemPolicy: "skip_to_next"
  }));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  const activation = await engine.activateBlock("training_cycle");
  await engine.reconcileTemporalState();
  assert.equal(engine.queries.getCycleNextItem("training_cycle").refId, "chest");
  clock.set("2026-08-25T00:30:00.000Z");
  await engine.reconcileTemporalState();
  await engine.reconcileTemporalState();
  assert.equal(engine.queries.getCycleNextItem("training_cycle").refId, "back");
  const periods = engine.queries.getState().cyclePeriods;
  assert.equal(periods.length, 2);
  assert.equal(periods[0].status, "missed");
  assert.equal(periods[0].policySnapshot.position, "continue");
  assert.equal(periods[0].policySnapshot.missedItem, "skip_to_next");
  assert.equal(periods[1].activationId, activation.value.id);
});

test("scheduled Activation and Run resumes are reconciled once", async () => {
  const state = stateAt();
  state.actions.push(action("work", "Work", "quantity"));
  state.blocks.push(block("routine", "Routine", "routine", [relationship("work_rel", "action", "work")]));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  const activation = await engine.activateBlock("routine");
  const run = await engine.startRun("routine", activation.value.id);
  await engine.pauseBlock(activation.value.id, "2026-08-24T11:00:00.000Z");
  await engine.pauseRun(run.value.id, "2026-08-24T11:00:00.000Z");
  clock.set("2026-08-24T11:00:00.000Z");
  await engine.reconcileTemporalState();
  await engine.reconcileTemporalState();
  const saved = engine.queries.getState();
  assert.equal(saved.activations[0].status, "manual");
  assert.equal(saved.runs[0].status, "running");
  assert.equal(saved.history.filter((item) => item.event === "block_resumed").length, 1);
  assert.equal(saved.history.filter((item) => item.event === "run_resumed").length, 1);
});
