import test from "node:test";
import assert from "node:assert/strict";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { action, block, deterministicIds, relationship, stateAt } from "../helpers.js";

function engineFor(state) {
  return new SamtEngine({ repository: new MemoryRepository(state), clock: new FakeClock("2026-08-24T10:00:00.000Z"), idFactory: deterministicIds(), timezone: "Europe/London" });
}

test("Routine Runs expose runtime state and auto-finish only after their rules are satisfied", async () => {
  const state = stateAt();
  state.actions.push(action("read", "Read", "quantity"));
  const routine = block("routine", "Morning Routine", "routine", [relationship("read_rel", "action", "read")]);
  routine.completion = { mode: "count", threshold: 1, requiredRelIds: [], afterThreshold: "auto" };
  state.blocks.push(routine);
  const engine = engineFor(state);
  await engine.initialize();
  const activation = await engine.activateBlock("routine");
  const started = await engine.startRun("routine", activation.value.id);
  assert.equal(engine.queries.getBlockDetail("routine").currentRun.id, started.value.id);
  await engine.logAction("read", { quantityPerformed: 1 });
  assert.equal(engine.queries.getState().runs[0].status, "completed");
  assert.equal(engine.queries.getBlockDetail("routine").currentRun, null);
  assert.equal(engine.queries.getState().history.filter((item) => item.event === "run_finished").length, 1);
});

test("Workflow Run progression ignores out-of-order global activity and finishes after the final step", async () => {
  const state = stateAt();
  state.actions.push(action("first", "First", "quantity"), action("second", "Second", "quantity"));
  state.blocks.push(block("workflow", "Ordered Work", "workflow", [relationship("first_rel", "action", "first"), relationship("second_rel", "action", "second")]));
  const engine = engineFor(state);
  await engine.initialize();
  const activation = await engine.activateBlock("workflow");
  const run = await engine.startRun("workflow", activation.value.id);
  const early = await engine.logAction("second", { quantityPerformed: 1 });
  assert.deepEqual(early.value.linkedRunIds, []);
  assert.equal(engine.queries.getState().runs[0].currentRelationshipId, "first_rel");
  await engine.logAction("first", { quantityPerformed: 1 });
  assert.equal(engine.queries.getState().runs[0].currentRelationshipId, "second_rel");
  const final = await engine.logAction("second", { quantityPerformed: 1, runId: run.value.id });
  assert.deepEqual(final.value.linkedRunIds, [run.value.id]);
  assert.equal(engine.queries.getState().runs[0].status, "completed");
});

test("Run pause/resume, Cycle advance, and non-executable Block boundaries are explicit", async () => {
  const state = stateAt();
  state.actions.push(action("chest", "Chest", "quantity"), action("back", "Back", "quantity"));
  state.blocks.push(
    block("cycle", "Training Cycle", "cycle", [relationship("chest_rel", "action", "chest"), relationship("back_rel", "action", "back")]),
    block("collection", "Library", "collection")
  );
  const engine = engineFor(state);
  await engine.initialize();
  const activation = await engine.activateBlock("cycle");
  await engine.pauseBlock("cycle");
  assert.equal(engine.queries.getBlockDetail("cycle").activeActivation.status, "paused");
  await engine.resumeBlock("cycle");
  assert.equal(engine.queries.getBlockDetail("cycle").activeActivation.status, "manual");
  const run = await engine.startRun("cycle", activation.value.id);
  await engine.pauseRun(run.value.id);
  assert.equal(engine.queries.getBlockDetail("cycle").currentRun.status, "paused");
  await engine.resumeRun(run.value.id);
  assert.equal(engine.queries.getBlockDetail("cycle").currentRun.status, "running");
  assert.equal(engine.queries.getCycleNextItem("cycle").refId, "chest");
  await engine.advanceCycle(activation.value.id);
  assert.equal(engine.queries.getCycleNextItem("cycle").refId, "back");
  await assert.rejects(() => engine.startRun("collection"), /do not create Runs/);
});

test("definition relationships, primary Project selection, and Bin restoration use commands", async () => {
  const state = stateAt();
  state.actions.push(action("write", "Write", "quantity"));
  state.blocks.push(block("project", "Publish", "project"));
  const engine = engineFor(state);
  await engine.initialize();
  const added = await engine.addBlockChild("project", { kind: "action", refId: "write", required: true });
  assert.equal(engine.queries.getBlockChildren("project")[0].object.id, "write");
  assert.deepEqual(engine.queries.getBlockById("project").completion.requiredRelIds, [added.value.id]);
  await engine.setPrimaryProject("project");
  assert.equal(engine.queries.getHomeViewModel().currentProject.id, "project");
  await engine.removeBlockChild("project", added.value.id);
  assert.equal(engine.queries.getBlockChildren("project").length, 0);
  const deleted = await engine.deleteDefinition("action", "write");
  assert.equal(engine.queries.getActionById("write"), null);
  await engine.restoreDefinition(deleted.value.id);
  assert.equal(engine.queries.getActionById("write").name, "Write");
  assert.equal(engine.queries.getState().bin.length, 0);
});

test("Project progress persists in its Run and enforces explicit outcome targets", async () => {
  const state = stateAt();
  state.actions.push(action("draft", "Draft Section", "quantity"));
  const project = block("book", "Write Book", "project", [relationship("draft_rel", "action", "draft")]);
  project.completion = { mode: "required_only", threshold: 0, requiredRelIds: ["draft_rel"], afterThreshold: "allow_extra" };
  project.projectTargets = [{ id: "draft_target", actionId: "draft", metric: "quantity", targetValue: 2 }];
  state.blocks.push(project);
  const engine = engineFor(state);
  await engine.initialize();
  const activation = await engine.activateBlock("book");
  const run = await engine.startRun("book", activation.value.id);
  await engine.logAction("draft", { quantityPerformed: 1 });
  assert.equal(engine.queries.getState().runs[0].progress.targetResults[0].actual, 1);
  await assert.rejects(() => engine.finishRun(run.value.id), /Project completion rules/);
  await engine.logAction("draft", { quantityPerformed: 1 });
  assert.equal(engine.queries.getState().runs[0].progress.complete, true);
  await engine.finishRun(run.value.id);
  assert.equal(engine.queries.getState().runs[0].status, "completed");
});

test("a closed Occurrence cannot be completed or skipped a second time", async () => {
  const state = stateAt();
  state.actions.push(action("task", "Task", "quantity"));
  state.occurrences.push({ id: "task_occurrence", actionId: "task", actionNameSnapshot: "Task", availableAt: "2026-08-24T08:00:00.000Z", dueAt: "2026-08-24T20:00:00.000Z", expiryPolicy: "expire", status: "due", actionLogIds: [], createdAt: "2026-08-24T08:00:00.000Z", updatedAt: "2026-08-24T08:00:00.000Z" });
  const engine = engineFor(state);
  await engine.initialize();
  await engine.skipOccurrence("task_occurrence");
  await assert.rejects(() => engine.completeOccurrence("task_occurrence"), /already closed/);
  await assert.rejects(() => engine.logAction("task", { quantityPerformed: 1, occurrenceId: "task_occurrence" }), /closed Occurrence/);
  assert.equal(engine.queries.getState().history.filter((item) => item.references?.occurrenceId === "task_occurrence" || item.occurrenceId === "task_occurrence").length, 1);
});
