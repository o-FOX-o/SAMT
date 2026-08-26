import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { SamtEngine } from "../../js/application/engine.js";
import { globalUniqueTime } from "../../js/domain/logs.js";
import { stateAt, action, block, relationship, deterministicIds } from "../helpers.js";

test("one Action Log links many Blocks but counts once globally", async () => {
  const state = stateAt();
  state.actions.push(action("a_mandarin", "Mandarin Vocabulary"));
  state.blocks.push(
    block("b_mandarin", "Mandarin", "target", [relationship("r1", "action", "a_mandarin")], { targetMetric: "time", targetValue: 60, period: { mode: "day" }, aggregation: "inclusive_unique" }),
    block("b_languages", "Languages", "collection", [relationship("r2", "block", "b_mandarin")]),
    block("b_study", "Study", "target", [relationship("r3", "block", "b_languages")], { targetMetric: "time", targetValue: 360, period: { mode: "week" }, aggregation: "inclusive_unique" }),
    block("b_daily", "Daily Productivity", "target", [relationship("r4", "block", "b_study")], { targetMetric: "time", targetValue: 360, period: { mode: "day" }, aggregation: "inclusive_unique" }),
    block("b_weekly", "Weekly Productivity", "target", [relationship("r5", "block", "b_daily")], { targetMetric: "time", targetValue: 4200, period: { mode: "week" }, aggregation: "inclusive_unique" })
  );
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock: new FakeClock("2026-08-24T10:00:00.000Z"), idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  const logged = await engine.logAction("a_mandarin", { durationPerformed: 30 });
  const saved = engine.queries.getState();
  assert.equal(saved.actionLogs.length, 1);
  assert.equal(saved.actionLogs[0].id, logged.value.id);
  assert.equal(saved.actionLogs[0].linkedBlockIds.length, 5);
  assert.equal(globalUniqueTime(saved.actionLogs), 30);
  assert.equal(engine.queries.getTargetProgress("b_weekly").actual, 30);
});
