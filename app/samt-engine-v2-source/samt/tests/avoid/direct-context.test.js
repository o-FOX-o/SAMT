import test from "node:test";
import assert from "node:assert/strict";
import { reconcileTemporalState } from "../../js/application/lifecycle.js";
import { action, block, relationship, stateAt } from "../helpers.js";

test("direct Avoid Action context auto-closes success without a fake log", () => {
  const state = stateAt("2026-08-24T08:00:00.000Z");
  state.actions.push(action("gaming", "Gaming", "time", "avoid"));
  state.blocks.push(block("self_control", "Self Control", "action_list", [relationship("rel_gaming", "action", "gaming", {
    avoidEvaluation: { mode: "binary_limit", metric: "time", binaryLimit: 0, period: { mode: "day" } }
  })]));
  reconcileTemporalState(state, { now: "2026-08-24T08:00:00.000Z", timezone: "Europe/London" });
  assert.equal(state.avoidPeriods.length, 1);
  reconcileTemporalState(state, { now: "2026-08-25T08:00:00.000Z", timezone: "Europe/London" });
  assert.equal(state.avoidPeriods.length, 2);
  assert.equal(state.avoidPeriods[0].status, "success");
  assert.equal(state.avoidPeriods[0].actual, 0);
  assert.equal(state.actionLogs.length, 0);
  assert.equal(state.history.filter((item) => item.event === "avoid_period_closed").length, 1);
});
