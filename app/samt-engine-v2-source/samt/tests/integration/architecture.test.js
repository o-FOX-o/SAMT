import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute } from "../../js/ui/router.js";
import { stateAt, action, block, relationship } from "../helpers.js";
import { getHomeViewModel } from "../../js/application/home.js";

test("domain modules import without DOM globals", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  delete globalThis.document;
  delete globalThis.window;
  await Promise.all(["targets", "avoid", "cycles", "scheduling", "logs", "relationships"].map((name) => import(`../../js/domain/${name}.js`)));
  assert.equal(globalThis.document, undefined);
  if (previousDocument) globalThis.document = previousDocument;
  if (previousWindow) globalThis.window = previousWindow;
});

test("public core entry imports without a browser UI", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  try {
    delete globalThis.document;
    delete globalThis.window;
    const core = await import("../../js/core.js");
    assert.equal(typeof core.calculateTargetProgress, "function");
    assert.equal(typeof core.evaluateAvoidPeriod, "function");
    assert.equal(typeof core.SamtEngine, "function");
  } finally {
    if (previousDocument !== undefined) globalThis.document = previousDocument;
    if (previousWindow !== undefined) globalThis.window = previousWindow;
  }
});

test("Open and Edit routes are distinct", () => {
  assert.deepEqual(parseRoute("#/blocks/block_one"), { name: "block-detail", path: "/blocks/block_one", id: "block_one" });
  assert.deepEqual(parseRoute("#/blocks/block_one/edit"), { name: "block-edit", path: "/blocks/block_one/edit", id: "block_one" });
});

test("Home view model separates positive Due and Avoid", () => {
  const state = stateAt();
  state.actions.push(action("a_do", "Do Work", "time", "do"), action("a_avoid", "Gaming", "time", "avoid"));
  state.blocks.push(block("b_list", "Self Control", "action_list", [relationship("r_avoid", "action", "a_avoid", { avoidEvaluation: { mode: "binary_limit", metric: "time", binaryLimit: 0, period: { mode: "day" } } })]));
  state.occurrences.push({ id: "o_do", actionId: "a_do", parentBlockId: "b_positive", availableAt: "2026-08-24T08:00:00.000Z", dueAt: "2026-08-24T12:00:00.000Z", status: "due", actionLogIds: [] });
  const model = getHomeViewModel(state, { now: "2026-08-24T10:00:00.000Z", timezone: "Europe/London" });
  assert.equal(model.due.dueNow.length, 1);
  assert.equal(model.avoid.length, 1);
  assert.equal(model.due.dueNow.some((item) => item.actionId === "a_avoid"), false);
});
