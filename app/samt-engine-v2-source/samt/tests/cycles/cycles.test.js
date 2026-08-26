import test from "node:test";
import assert from "node:assert/strict";
import { distributeCycleFrequency, advanceCycle, applyCyclePeriodEnd, applyMissedCycleItemPolicy } from "../../js/domain/cycles.js";

test("smooth weighted Cycle distribution is deterministic", () => {
  const sequence = distributeCycleFrequency([{ id: "chest", refId: "chest", frequency: 4 }, { id: "legs", refId: "legs", frequency: 2 }]);
  assert.deepEqual(sequence.map((item) => item.refId), ["chest", "legs", "chest", "chest", "legs", "chest"]);
});

test("Cycle position continues across period close", () => {
  const afterChest = advanceCycle({ currentPosition: 0, currentRound: 1 }, 3);
  assert.equal(afterChest.currentPosition, 1);
  assert.equal(applyCyclePeriodEnd(afterChest, { position: "continue" }).currentPosition, 1);
});

test("missed Cycle item policy keeps, skips or restarts", () => {
  const current = { currentPosition: 0, currentRound: 1 };
  assert.equal(applyMissedCycleItemPolicy(current, 2, "keep").currentPosition, 0);
  assert.equal(applyMissedCycleItemPolicy(current, 2, "skip_to_next").currentPosition, 1);
  assert.equal(applyMissedCycleItemPolicy({ currentPosition: 1 }, 2, "restart_cycle").currentPosition, 0);
});
