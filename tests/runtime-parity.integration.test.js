import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeClock } from '../js/infrastructure/clock.js';
import { memoryRepository } from '../js/infrastructure/repository.js';
import { createEmptyState } from '../js/application/normalization.js';
import { createEngine } from '../js/application/engine.js';

function harness(value = '2026-01-01T10:00:00Z') {
  const clock = fakeClock(new Date(value), 'UTC');
  const repository = memoryRepository(createEmptyState(clock.now()));
  return { clock, repository, engine: createEngine({ repository, clock }) };
}

function action(engine, id, name, completion = { method: 'time', minimumMinutes: 1 }) {
  return engine.commands.createAction({ id, name, completion });
}

test('Routine Runs initialize fresh children, aggregate logs and stop at READY_TO_FINISH', () => {
  const { clock, repository, engine } = harness();
  const item = action(engine, 'action_routine_item', 'Read', { method: 'time', minimumMinutes: 1 });
  const routine = engine.commands.createBlock({
    id: 'block_routine_runtime',
    type: 'routine',
    name: 'Reading session',
    definitionStatus: 'ACTIVE',
    config: { completionMode: 'count', minimumCount: 1, finishBehaviour: 'ready' }
  });
  const relationship = engine.commands.addRelationship(routine.id, {
    id: 'relationship_routine_item',
    kind: 'action',
    refId: item.id,
    config: { required: true }
  });

  const first = engine.commands.startRun({ blockId: routine.id, label: 'First session' });
  assert.equal(first.children[0].state, 'AVAILABLE');
  engine.commands.logAction({
    actionId: item.id,
    runId: first.id,
    relationshipId: relationship.id,
    durationMinutes: 0.5,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().runs[0].children[0].state, 'IN_PROGRESS');

  engine.commands.logAction({
    actionId: item.id,
    runId: first.id,
    relationshipId: relationship.id,
    durationMinutes: 0.5,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().runs[0].status, 'READY_TO_FINISH');
  engine.commands.finishRun(first.id);
  assert.equal(repository.getState().runs[0].status, 'COMPLETED');

  const second = engine.commands.startRun({ blockId: routine.id, label: 'Fresh session' });
  assert.equal(second.children[0].state, 'AVAILABLE');
  assert.equal(second.children[0].logIds.length, 0);
});

test('Workflow Runs own ordered steps, preserve blocking state and support return-to-step', () => {
  const { clock, repository, engine } = harness();
  const firstAction = action(engine, 'action_workflow_first', 'Prepare', { method: 'time', minimumMinutes: 1 });
  const secondAction = action(engine, 'action_workflow_second', 'Publish', { method: 'time', minimumMinutes: 1 });
  const workflow = engine.commands.createBlock({
    id: 'block_workflow_runtime',
    type: 'workflow',
    name: 'Release process',
    definitionStatus: 'ACTIVE',
    config: { finishBehaviour: 'ready' }
  });
  const firstRelationship = engine.commands.addRelationship(workflow.id, {
    id: 'relationship_workflow_first',
    kind: 'action',
    refId: firstAction.id,
    config: { required: true }
  });
  const secondRelationship = engine.commands.addRelationship(workflow.id, {
    id: 'relationship_workflow_second',
    kind: 'action',
    refId: secondAction.id,
    config: { required: true }
  });

  const run = engine.commands.startRun({ blockId: workflow.id, label: 'Release 1' });
  assert.deepEqual(run.steps.map((step) => step.state), ['AVAILABLE', 'LOCKED']);
  assert.throws(() => engine.commands.completeWorkflowStep(run.id, firstRelationship.id), /Log enough/);
  engine.commands.startWorkflowStep(run.id, firstRelationship.id);
  engine.commands.logAction({
    actionId: firstAction.id,
    runId: run.id,
    relationshipId: firstRelationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.deepEqual(repository.getState().runs[0].steps.map((step) => step.state), ['COMPLETED', 'AVAILABLE']);

  const expectedUnblock = '2026-01-02T10:00:00.000Z';
  engine.commands.blockWorkflowStep(run.id, secondRelationship.id, 'Waiting for approval', expectedUnblock);
  let current = repository.getState().runs[0];
  assert.equal(current.steps[1].state, 'BLOCKED');
  assert.equal(current.steps[1].reason, 'Waiting for approval');
  assert.equal(current.steps[1].expectedUnblockAt, expectedUnblock);
  engine.commands.unblockWorkflowStep(run.id, secondRelationship.id);
  engine.commands.logAction({
    actionId: secondAction.id,
    runId: run.id,
    relationshipId: secondRelationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().runs[0].status, 'READY_TO_FINISH');
  engine.commands.finishRun(run.id);
  assert.equal(repository.getState().runs[0].status, 'COMPLETED');

  const returnedRun = engine.commands.startRun({ blockId: workflow.id, label: 'Release 2' });
  engine.commands.returnToWorkflowStep(returnedRun.id, firstRelationship.id);
  current = repository.getState().runs.find((candidate) => candidate.id === returnedRun.id);
  assert.deepEqual(current.steps.map((step) => step.state), ['AVAILABLE', 'LOCKED']);
  assert.equal(current.transitions.at(-1).type, 'RETURN_TO_STEP');
});

test('Project Runs enforce dependencies, milestones, READY_TO_FINISH and preserve scope history', () => {
  const { clock, repository, engine } = harness();
  const firstAction = action(engine, 'action_project_first', 'Design', { method: 'time', minimumMinutes: 1 });
  const secondAction = action(engine, 'action_project_second', 'Build', { method: 'time', minimumMinutes: 1 });
  const optionalAction = action(engine, 'action_project_optional', 'Polish', { method: 'time', minimumMinutes: 1 });
  const project = engine.commands.createBlock({
    id: 'block_project_runtime',
    type: 'project',
    name: 'Launch',
    definitionStatus: 'ACTIVE',
    config: {
      finishBehaviour: 'ready',
      conditions: [{ type: 'all_required' }],
      milestones: [{ id: 'milestone_launch', name: 'Launch review', required: true }]
    }
  });
  const firstRelationship = engine.commands.addRelationship(project.id, {
    id: 'relationship_project_first',
    kind: 'action',
    refId: firstAction.id,
    config: { required: true }
  });
  const secondRelationship = engine.commands.addRelationship(project.id, {
    id: 'relationship_project_second',
    kind: 'action',
    refId: secondAction.id,
    config: { required: true, dependencyIds: [firstRelationship.id] }
  });
  const optionalRelationship = engine.commands.addRelationship(project.id, {
    id: 'relationship_project_optional',
    kind: 'action',
    refId: optionalAction.id,
    config: { required: false }
  });

  const run = engine.commands.startRun({ blockId: project.id, label: 'Launch outcome' });
  assert.equal(run.children.find((child) => child.relationshipId === secondRelationship.id).state, 'LOCKED');
  engine.commands.updateProjectChild(run.id, optionalRelationship.id, 'BLOCKED', 'Waiting on vendor', { expectedUnblockAt: '2026-01-03T10:00:00.000Z' });
  let current = repository.getState().runs[0];
  assert.equal(current.children.find((child) => child.relationshipId === optionalRelationship.id).state, 'BLOCKED');

  engine.commands.logAction({
    actionId: firstAction.id,
    runId: run.id,
    relationshipId: firstRelationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  current = repository.getState().runs[0];
  assert.equal(current.children.find((child) => child.relationshipId === firstRelationship.id).state, 'COMPLETED');
  assert.equal(current.children.find((child) => child.relationshipId === secondRelationship.id).state, 'AVAILABLE');

  engine.commands.logAction({
    actionId: secondAction.id,
    runId: run.id,
    relationshipId: secondRelationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().runs[0].status, 'IN_PROGRESS');
  engine.commands.completeProjectMilestone(run.id, 'milestone_launch');
  assert.equal(repository.getState().runs[0].status, 'READY_TO_FINISH');

  const before = repository.getState().scopeChangeEvents.length;
  engine.commands.updateBlock(project.id, { config: { ...project.config, description: 'scope change' } });
  assert.equal(repository.getState().scopeChangeEvents.length, before + 1);
  engine.commands.finishRun(run.id);
  assert.equal(repository.getState().runs[0].status, 'COMPLETED');
});

test('Project Result conditions convert compatible Units and reject incompatible Units atomically', () => {
  const { clock, repository, engine } = harness();
  const measured = action(engine, 'action_project_measurement', 'Weigh in', { method: 'time', minimumMinutes: 1 });
  const field = engine.commands.addResultField(measured.id, {
    id: 'result_project_weight',
    type: 'measurement',
    label: 'Weight',
    config: { defaultUnitId: 'unit_kg', allowedUnitIds: ['unit_kg', 'unit_g'] }
  });
  const compatibleProject = engine.commands.createBlock({
    id: 'block_project_measurement',
    type: 'project',
    name: 'Weight gate',
    definitionStatus: 'ACTIVE',
    config: {
      finishBehaviour: 'ready',
      conditions: [{ type: 'result', fieldId: field.id, operator: '>=', value: { value: 60, unitId: 'unit_kg' } }]
    }
  });
  const compatibleRelationship = engine.commands.addRelationship(compatibleProject.id, {
    id: 'relationship_project_measurement',
    kind: 'action',
    refId: measured.id,
    config: { required: true }
  });
  const compatibleRun = engine.commands.startRun({ blockId: compatibleProject.id });
  engine.commands.logAction({
    actionId: measured.id,
    runId: compatibleRun.id,
    relationshipId: compatibleRelationship.id,
    durationMinutes: 1,
    resultValues: [{ fieldId: field.id, value: { value: 70000, unitId: 'unit_g' } }],
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().runs.find((run) => run.id === compatibleRun.id).status, 'READY_TO_FINISH');

  const incompatibleProject = engine.commands.createBlock({
    id: 'block_project_bad_unit',
    type: 'project',
    name: 'Invalid weight gate',
    definitionStatus: 'ACTIVE',
    config: {
      finishBehaviour: 'ready',
      conditions: [{ type: 'result', fieldId: field.id, operator: '>=', value: { value: 60, unitId: 'unit_km' } }]
    }
  });
  const incompatibleRelationship = engine.commands.addRelationship(incompatibleProject.id, {
    id: 'relationship_project_bad_unit',
    kind: 'action',
    refId: measured.id,
    config: { required: true }
  });
  const badRun = engine.commands.startRun({ blockId: incompatibleProject.id });
  const logsBefore = repository.getState().actionLogs.length;
  assert.throws(() => engine.commands.logAction({
    actionId: measured.id,
    runId: badRun.id,
    relationshipId: incompatibleRelationship.id,
    durationMinutes: 1,
    resultValues: [{ fieldId: field.id, value: { value: 70000, unitId: 'unit_g' } }],
    eventAt: clock.now(),
    finalizing: true
  }), /incompatible Units/);
  assert.equal(repository.getState().actionLogs.length, logsBefore);
});

test('Cycle execution follows generated exact slots, tracks coverage and starts the next Big Cycle', () => {
  const { clock, repository, engine } = harness();
  const firstAction = action(engine, 'action_cycle_first', 'First slot', { method: 'time', minimumMinutes: 1 });
  const secondAction = action(engine, 'action_cycle_second', 'Second slot', { method: 'time', minimumMinutes: 1 });
  const cycle = engine.commands.createBlock({
    id: 'block_cycle_runtime',
    type: 'cycle',
    name: 'Exact cycle',
    definitionStatus: 'ACTIVE',
    config: { generationMode: 'exact_frequency', smallCycleSize: 2 }
  });
  const firstRelationship = engine.commands.addRelationship(cycle.id, {
    id: 'relationship_cycle_first',
    kind: 'action',
    refId: firstAction.id,
    config: { exactCount: 1 }
  });
  const secondRelationship = engine.commands.addRelationship(cycle.id, {
    id: 'relationship_cycle_second',
    kind: 'action',
    refId: secondAction.id,
    config: { exactCount: 1 }
  });
  const small = engine.commands.generateCycleSmallCycle(cycle.id);
  assert.deepEqual(small.slots.map((slot) => slot.relationshipId), [firstRelationship.id, secondRelationship.id]);
  engine.commands.logAction({
    actionId: firstAction.id,
    blockId: cycle.id,
    relationshipId: firstRelationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  let big = repository.getState().cycleBigCycles[0];
  assert.equal(big.resolutions[0].relationshipId, firstRelationship.id);
  assert.equal(big.completionCoverage.includes(firstRelationship.id), true);
  assert.equal(big.currentSlot, 1);

  engine.commands.logAction({
    actionId: secondAction.id,
    blockId: cycle.id,
    relationshipId: secondRelationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  big = repository.getState().cycleBigCycles[0];
  assert.equal(big.status, 'completed');
  assert.equal(big.appearanceCoverage.includes(secondRelationship.id), true);
  assert.equal(big.currentSlot, 2);

  const next = engine.commands.generateCycleSmallCycle(cycle.id);
  assert.equal(next.smallCycleNumber, 1);
  assert.equal(repository.getState().cycleBigCycles.length, 2);
});

test('Action List interval anchors use completed lifecycle records and relationship edits keep IDs', () => {
  const { clock, repository, engine } = harness();
  const item = action(engine, 'action_list_runtime', 'Daily item', { method: 'time', minimumMinutes: 1 });
  const list = engine.commands.createBlock({
    id: 'block_action_list_runtime',
    type: 'action_list',
    name: 'Scheduled list',
    definitionStatus: 'ACTIVE'
  });
  const relationship = engine.commands.addRelationship(list.id, {
    id: 'relationship_action_list_runtime',
    kind: 'action',
    refId: item.id,
    config: { schedule: { mode: 'calendar', calendarKind: 'daily', dateOnly: true } }
  });

  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 1);
  const occurrence = repository.getState().occurrences[0];
  engine.commands.logAction({
    actionId: item.id,
    occurrenceId: occurrence.id,
    relationshipId: relationship.id,
    contextRefs: [{ occurrenceId: occurrence.id }],
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().occurrences[0].status, 'completed');

  const edited = engine.commands.updateRelationship(list.id, relationship.id, {
    config: { schedule: { mode: 'interval', every: 1, unit: 'days', anchor: 'previous_completion', dateOnly: false } }
  });
  assert.equal(edited.id, relationship.id);
  clock.set('2026-01-02T10:00:00Z');
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 1);
  const nextOccurrence = repository.getState().occurrences.find((candidate) => candidate.id !== occurrence.id);
  assert.equal(nextOccurrence.relationshipId, relationship.id);
  assert.equal(nextOccurrence.scheduledAt, '2026-01-02T10:00:00.000Z');

  engine.commands.updateRelationship(list.id, relationship.id, {
    config: { schedule: { mode: 'interval', every: 1, unit: 'days', anchor: 'previous_occurrence', dateOnly: false } }
  });
  clock.set('2026-01-03T10:00:00Z');
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 1);
  assert.equal(repository.getState().occurrences.length, 3);
});

test('scheduled Activations gate real Run creation and remain idempotent', () => {
  const { clock, repository, engine } = harness();
  const item = action(engine, 'action_activation_runtime', 'Activated item');
  const routine = engine.commands.createBlock({
    id: 'block_activation_runtime',
    type: 'routine',
    name: 'Activated routine',
    definitionStatus: 'ACTIVE'
  });
  engine.commands.addRelationship(routine.id, {
    id: 'relationship_activation_item',
    kind: 'action',
    refId: item.id,
    config: { required: true }
  });
  const activation = engine.commands.createActivation({
    id: 'activation_future',
    blockId: routine.id,
    mode: 'schedule',
    recurrence: { mode: 'once', date: '2026-01-02' },
    label: 'Scheduled routine'
  });
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 0);
  clock.set('2026-01-02T10:00:00Z');
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 1);
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 0);
  const run = repository.getState().runs[0];
  assert.equal(run.activationId, activation.id);
  assert.equal(repository.getState().activations[0].runCount, 1);
  assert.equal(run.children[0].state, 'AVAILABLE');
});


test('Action List Activations gate occurrence generation and honor calendar local time', () => {
  const { clock, repository, engine } = harness('2026-01-01T08:00:00Z');
  const item = action(engine, 'action_activation_list', 'Activated list item');
  const list = engine.commands.createBlock({
    id: 'block_activation_list',
    type: 'action_list',
    name: 'Activated list',
    definitionStatus: 'ACTIVE'
  });
  const relationship = engine.commands.addRelationship(list.id, {
    id: 'relationship_activation_list',
    kind: 'action',
    refId: item.id,
    config: { schedule: { mode: 'calendar', calendarKind: 'daily', dateOnly: false, time: '09:30' } }
  });
  engine.commands.createActivation({
    id: 'activation_list_start',
    blockId: list.id,
    mode: 'schedule',
    recurrence: { mode: 'calendar', calendarKind: 'daily', startDate: '2026-01-02' },
    label: 'Enable list'
  });

  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 0);
  clock.set('2026-01-02T09:29:00Z');
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 0);
  clock.set('2026-01-02T09:30:00Z');
  assert.equal(engine.reconcile({ now: clock.now(), timezone: 'UTC' }).created.length, 1);
  const occurrence = repository.getState().occurrences[0];
  assert.equal(occurrence.relationshipId, relationship.id);
  assert.equal(occurrence.scheduledAt, '2026-01-02T09:30:00.000Z');
});

test('Cycle deferred and unavailable outcomes keep the generated slot for later', () => {
  const { repository, engine } = harness();
  const item = action(engine, 'action_cycle_defer', 'Deferred slot');
  const cycle = engine.commands.createBlock({
    id: 'block_cycle_defer',
    type: 'cycle',
    name: 'Deferred cycle',
    definitionStatus: 'ACTIVE',
    config: { generationMode: 'exact_frequency', smallCycleSize: 1 }
  });
  const relationship = engine.commands.addRelationship(cycle.id, {
    id: 'relationship_cycle_defer',
    kind: 'action',
    refId: item.id,
    config: { exactCount: 1, allowDefer: true, allowUnavailable: true, manualCompletion: true }
  });
  const small = engine.commands.generateCycleSmallCycle(cycle.id);
  assert.equal(small.slots[0].relationshipId, relationship.id);

  const deferred = engine.commands.resolveCycleSlot(cycle.id, { outcome: 'deferred' });
  assert.equal(deferred.bigCycle.currentSlot, 0);
  assert.deepEqual(deferred.bigCycle.appearanceCoverage, []);
  assert.equal(deferred.bigCycle.resolutions.at(-1).outcome, 'deferred');

  const completed = engine.commands.resolveCycleSlot(cycle.id, { outcome: 'completed' });
  assert.equal(completed.bigCycle.status, 'completed');
  assert.equal(completed.bigCycle.completionCoverage.includes(relationship.id), true);
});

test('explicit Action Log deletion cleans runtime references and reopens derived completion', () => {
  const { clock, repository, engine } = harness();
  const item = action(engine, 'action_delete_runtime', 'Delete me', { method: 'time', minimumMinutes: 1 });
  const routine = engine.commands.createBlock({
    id: 'block_delete_runtime',
    type: 'routine',
    name: 'Deletion routine',
    definitionStatus: 'ACTIVE'
  });
  const relationship = engine.commands.addRelationship(routine.id, {
    id: 'relationship_delete_runtime',
    kind: 'action',
    refId: item.id,
    config: { required: true }
  });
  const run = engine.commands.startRun({ blockId: routine.id });
  const log = engine.commands.logAction({
    actionId: item.id,
    runId: run.id,
    relationshipId: relationship.id,
    durationMinutes: 1,
    eventAt: clock.now(),
    finalizing: true
  });
  assert.equal(repository.getState().runs[0].children[0].state, 'COMPLETED');
  assert.equal(repository.getState().runs[0].status, 'COMPLETED');

  engine.commands.deleteActionLog(log.id);
  const current = repository.getState();
  assert.equal(current.actionLogs.length, 0);
  assert.deepEqual(current.runs[0].children[0].logIds, []);
  assert.equal(current.runs[0].children[0].state, 'AVAILABLE');
  assert.equal(current.runs[0].status, 'NOT_STARTED');
});

test('Weighted Cycle runtime resolves the generated slot and carries fairness forward', () => {
  const { repository, engine } = harness();
  const lowAction = action(engine, 'action_cycle_weight_low', 'Low weight');
  const highAction = action(engine, 'action_cycle_weight_high', 'High weight');
  const cycle = engine.commands.createBlock({
    id: 'block_cycle_weighted',
    type: 'cycle',
    name: 'Weighted cycle',
    definitionStatus: 'ACTIVE',
    config: { generationMode: 'weighted_limited', smallCycleSize: 1 }
  });
  const low = engine.commands.addRelationship(cycle.id, {
    id: 'relationship_cycle_weight_low',
    kind: 'action',
    refId: lowAction.id,
    config: { appearanceMode: 'weighted', weight: 1, manualCompletion: true }
  });
  const high = engine.commands.addRelationship(cycle.id, {
    id: 'relationship_cycle_weight_high',
    kind: 'action',
    refId: highAction.id,
    config: { appearanceMode: 'weighted', weight: 4, manualCompletion: true }
  });

  const first = engine.commands.generateCycleSmallCycle(cycle.id);
  assert.equal(first.slots[0].relationshipId, high.id);
  assert.notEqual(first.slots[0].relationshipId, low.id);
  const resolved = engine.commands.resolveCycleSlot(cycle.id, { outcome: 'completed' });
  assert.equal(resolved.resolution.relationshipId, high.id);
  assert.equal(repository.getState().cycleBigCycles[0].currentSlot, 1);

  const second = engine.commands.generateCycleSmallCycle(cycle.id);
  assert.equal(second.smallCycleNumber, 2);
  assert.equal(second.slots[0].relationshipId, high.id);
  assert.notEqual(second.fairness[high.id], first.fairness[high.id]);
});
