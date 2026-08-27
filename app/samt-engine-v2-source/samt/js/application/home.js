import { calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidActionPeriod, evaluateAvoidPeriod, normalizeAvoidEvaluation } from "../domain/avoid.js";
import { distributeCycleFrequency, resolveNextEligibleItem } from "../domain/cycles.js";
import { calculatePeriodBounds, withinBounds } from "../shared/dates.js";
import { getActionById, getAvailableOccurrences, getBlockById, getDueOccurrences, getOccurrenceView, getRunningRuns, getUpcomingOccurrences } from "./selectors.js";
import { ACTIVE_ACTIVATION_STATUSES } from "../domain/activations.js";

function targetCard(state, block, now, timezone) {
  const progress = calculateTargetProgress({ state, block, now, timezone });
  const start = progress.bounds.start ? Date.parse(progress.bounds.start) : null;
  const end = progress.bounds.end ? Date.parse(progress.bounds.end) : null;
  const elapsedPercentage = start != null && end != null && end > start ? Math.max(0, Math.min(100, ((Date.parse(now) - start) / (end - start)) * 100)) : null;
  return { kind: "target", id: block.id, name: block.name, period: block.typeConfig?.period?.mode || block.typeConfig?.period || "all_time", deadlineAt: progress.bounds.end, elapsedPercentage, ...progress };
}

function directAvoidActionItems(state, now, timezone) {
  const output = [];
  for (const block of state.blocks.filter((item) => item.status === "active" && item.type === "action_list")) {
    for (const relationship of block.children || []) {
      if (relationship.kind !== "action") continue;
      const action = getActionById(state, relationship.refId);
      if (!action || action.direction !== "avoid") continue;
      const activePeriod = [...(state.avoidPeriods || [])].reverse().find((item) => item.relationshipId === relationship.id && !item.closedAt && item.lifecycleStatus !== "closed");
      const evaluation = normalizeAvoidEvaluation(activePeriod?.evaluationSnapshot || relationship.avoidEvaluation || block.typeConfig?.avoidEvaluation || { mode: "binary_limit", metric: action.avoidMetricHint || (action.completion?.method === "time" ? "time" : "count"), binaryLimit: 0, period: { mode: "day" } });
      const bounds = activePeriod ? { start: activePeriod.periodStart, end: activePeriod.periodEnd } : undefined;
      const result = evaluateAvoidActionPeriod({ logs: state.actionLogs, actionId: action.id, evaluation, now, timezone, bounds });
      output.push({ id: `${block.id}:${action.id}`, actionId: action.id, blockId: block.id, relationshipId: relationship.id, name: action.name, contextName: block.name, ...result });
    }
  }
  return output;
}

function itemIsEligible(state, item) {
  return item.kind === "action" ? getActionById(state, item.refId)?.status === "active" : getBlockById(state, item.refId)?.status === "active";
}

function currentCycleChoices(state) {
  const choices = [];
  for (const block of state.blocks.filter((item) => item.type === "cycle" && item.status === "active")) {
    const activation = state.activations.find((item) => item.blockId === block.id && ACTIVE_ACTIVATION_STATUSES.includes(item.status) && item.status !== "paused");
    if (!activation) continue;
    const sequence = activation.roundSnapshot || distributeCycleFrequency(block.children || []);
    const next = resolveNextEligibleItem(sequence, activation.cycleState || activation, (item) => itemIsEligible(state, item), block.typeConfig?.eligibilityMode || "next_eligible");
    if (next) choices.push({ kind: "cycle", blockId: block.id, blockName: block.name, relationshipId: next.item.sourceRelationshipId || next.item.id, refId: next.item.refId, refKind: next.item.kind, label: next.item.kind === "action" ? getActionById(state, next.item.refId)?.name : getBlockById(state, next.item.refId)?.name });
  }
  return choices;
}

function dailyContextCards(state, now, timezone) {
  const bounds = calculatePeriodBounds({ mode: "day" }, now, timezone);
  const current = state.occurrences.map((item) => getOccurrenceView(state, item, now)).filter((item) => item.direction === "do" && item.availableAt && withinBounds(item.availableAt, bounds));
  const grouped = new Map();
  for (const occurrence of current) {
    const blockId = occurrence.parentBlockId || occurrence.blockId || occurrence.contextBlockId;
    if (!blockId) continue;
    const block = getBlockById(state, blockId);
    if (!block || block.type === "target") continue;
    if (!grouped.has(blockId)) grouped.set(blockId, { kind: "occurrence_context", id: blockId, name: block.name, blockType: block.type, total: 0, completed: 0, missed: 0, due: 0, available: 0, upcoming: 0 });
    const row = grouped.get(blockId);
    row.total += 1;
    if (occurrence.status === "completed") row.completed += 1;
    else if (occurrence.status === "missed") row.missed += 1;
    else if (["due", "overdue", "partial"].includes(occurrence.status)) row.due += 1;
    else if (occurrence.status === "available") row.available += 1;
    else if (occurrence.status === "upcoming") row.upcoming += 1;
  }
  return [...grouped.values()].map((row) => ({ ...row, percentage: row.total ? (row.completed / row.total) * 100 : 0, status: row.missed ? "missed" : row.completed === row.total ? "completed" : row.due ? "due" : "in_progress" }));
}

function currentProjectView(state, now) {
  const project = state.settings?.primaryProjectId ? getBlockById(state, state.settings.primaryProjectId) : null;
  if (!project || project.type !== "project") return null;
  const run = [...state.runs].reverse().find((item) => item.blockId === project.id && ["running", "active", "paused"].includes(item.status));
  const deadlineAt = project.typeConfig?.deadlineAt || project.deadlineAt || null;
  return { ...project, runningRunId: run?.id || null, progress: run?.progress || null, deadlineAt, overdue: Boolean(deadlineAt && Date.parse(deadlineAt) < Date.parse(now)) };
}

function occurrenceChoice(item) { return { kind: "occurrence", id: item.id, label: item.actionName, required: item.required }; }

export function getHomeViewModel(state, { now, timezone }) {
  const running = getRunningRuns(state).map((run) => ({ ...run, block: getBlockById(state, run.blockId) }));
  const dueAll = getDueOccurrences(state, now);
  const overdue = dueAll.filter((item) => item.status === "overdue");
  const dueNow = dueAll.filter((item) => ["due", "partial"].includes(item.status));
  const available = getAvailableOccurrences(state, now);
  const dayBounds = calculatePeriodBounds({ mode: "day" }, now, timezone);
  const upcomingAll = getUpcomingOccurrences(state, now, 50);
  const laterToday = upcomingAll.filter((item) => item.availableAt && withinBounds(item.availableAt, dayBounds));
  const upcoming = upcomingAll.filter((item) => !laterToday.some((todayItem) => todayItem.id === item.id)).slice(0, 5);
  const cycles = currentCycleChoices(state);
  const positiveTargets = state.blocks.filter((block) => block.type === "target" && block.status === "active" && block.direction !== "avoid");
  const dailyTargets = positiveTargets.filter((block) => (block.typeConfig?.period?.mode || block.typeConfig?.period) === "day").map((block) => targetCard(state, block, now, timezone));
  const today = [...dailyTargets, ...dailyContextCards(state, now, timezone)];
  const thisWeek = positiveTargets.filter((block) => (block.typeConfig?.period?.mode || block.typeConfig?.period) === "week").map((block) => targetCard(state, block, now, timezone));
  const avoidBlocks = state.blocks.filter((block) => block.status === "active" && block.direction === "avoid").map((block) => ({ id: block.id, name: block.name, ...evaluateAvoidPeriod({ state, block, now, timezone }) }));
  const avoid = [...avoidBlocks, ...directAvoidActionItems(state, now, timezone)];
  let nowChoices = [];
  if (running.length) nowChoices = running.map((item) => ({ kind: "run", id: item.id, label: item.block?.name || item.blockNameSnapshot }));
  else if (overdue.some((item) => item.required)) nowChoices = overdue.filter((item) => item.required).map(occurrenceChoice);
  else if (dueNow.some((item) => item.required)) nowChoices = dueNow.filter((item) => item.required).map(occurrenceChoice);
  else if (cycles.length) nowChoices = cycles;
  else {
    const approaching = [...dailyTargets, ...thisWeek].filter((item) => !item.reached && item.elapsedPercentage >= 75).sort((a, b) => b.elapsedPercentage - a.elapsedPercentage || b.percentage - a.percentage);
    if (approaching.length) nowChoices = approaching.slice(0, approaching[0].elapsedPercentage === approaching[1]?.elapsedPercentage ? 2 : 1).map((item) => ({ kind: "target", id: item.id, label: item.name }));
    else if (overdue.length) nowChoices = overdue.map(occurrenceChoice);
    else if (dueNow.length) nowChoices = dueNow.map(occurrenceChoice);
    else if (available.length) nowChoices = available.slice(0, 3).map(occurrenceChoice);
    else if (laterToday.length === 1) nowChoices = laterToday.map(occurrenceChoice);
  }
  const recentActionIds = [...state.actionLogs].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).map((item) => item.actionId);
  const quickLog = [...new Set(recentActionIds.concat(state.actions.filter((item) => item.status === "active").map((item) => item.id)))].map((id) => getActionById(state, id)).filter(Boolean);
  return { now, nowChoices, running, due: { overdue, dueNow, laterToday }, available, avoid, today, thisWeek, currentProject: currentProjectView(state, now), upcoming, quickLog };
}
