import test from "node:test";
import assert from "node:assert/strict";
import { getHomeViewModel } from "../../js/application/home.js";
import { action, block, relationship, stateAt } from "../helpers.js";

test("Home query returns running, positive Due, five Avoid items, Targets, primary Project, and limited Upcoming", () => {
  const state = stateAt();
  state.actions.push(action("work", "Deep Work"));
  for (const name of ["Gaming", "Shorts", "Movies", "Music", "Impulse"]) state.actions.push(action(`avoid_${name.toLowerCase()}`, name, name === "Impulse" ? "quantity" : "time", "avoid"));
  state.blocks.push(
    block("routine", "Current Routine", "routine", [relationship("work_rel", "action", "work")]),
    block("self_control", "Self Control", "action_list", state.actions.filter((item) => item.direction === "avoid").map((item, index) => relationship(`avoid_rel_${index}`, "action", item.id, { avoidEvaluation: { mode: item.name === "Impulse" ? "violation_multiplier" : "binary_limit", metric: item.name === "Impulse" ? "count" : "time", binaryLimit: 0, allowedCount: 0, violationPenalty: 100, period: { mode: "day" } } }))),
    block("daily_target", "Daily Productivity", "target", [relationship("daily_work_rel", "action", "work")], { targetMetric: "time", targetValue: 60, period: { mode: "day" }, aggregation: "inclusive_unique" }),
    block("weekly_target", "Weekly Productivity", "target", [relationship("weekly_work_rel", "action", "work")], { targetMetric: "time", targetValue: 360, period: { mode: "week" }, aggregation: "inclusive_unique" }),
    block("project", "Primary Project", "project")
  );
  state.settings.primaryProjectId = "project";
  state.runs.push({ id: "run_current", blockId: "routine", blockNameSnapshot: "Current Routine", status: "running", startAt: "2026-08-24T08:00:00.000Z", actionLogIds: [], progress: {}, createdAt: "2026-08-24T08:00:00.000Z", updatedAt: "2026-08-24T08:00:00.000Z" });
  state.occurrences.push(
    { id: "overdue_work", actionId: "work", actionNameSnapshot: "Deep Work", parentBlockId: "routine", blockNameSnapshot: "Current Routine", relationshipId: "work_rel", availableAt: "2026-08-23T08:00:00.000Z", dueAt: "2026-08-23T20:00:00.000Z", expiryPolicy: "carry_forward", status: "overdue", actionLogIds: [] },
    { id: "upcoming_work", actionId: "work", actionNameSnapshot: "Deep Work", parentBlockId: "routine", blockNameSnapshot: "Current Routine", relationshipId: "work_rel", availableAt: "2026-08-25T08:00:00.000Z", dueAt: "2026-08-25T20:00:00.000Z", expiryPolicy: "expire", status: "upcoming", actionLogIds: [] }
  );
  const model = getHomeViewModel(state, { now: "2026-08-24T10:00:00.000Z", timezone: "Europe/London" });
  assert.deepEqual(model.nowChoices.map((item) => item.id), ["run_current"]);
  assert.equal(model.due.overdue.length, 1);
  assert.equal(model.due.overdue[0].direction, "do");
  assert.equal(model.avoid.length, 5);
  assert.equal(model.today.some((item) => item.id === "daily_target"), true);
  assert.equal(model.thisWeek.some((item) => item.id === "weekly_target"), true);
  assert.equal(model.currentProject.id, "project");
  assert.equal(model.upcoming.length, 1);
});
