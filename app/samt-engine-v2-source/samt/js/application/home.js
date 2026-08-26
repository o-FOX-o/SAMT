import { calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidActionPeriod, evaluateAvoidPeriod, normalizeAvoidEvaluation } from "../domain/avoid.js";
import { distributeCycleFrequency, resolveNextEligibleItem } from "../domain/cycles.js";
import { getDescendantActionIds } from "../domain/relationships.js";
import { getActionById, getBlockById, getDueOccurrences, getRunningRuns, getUpcomingOccurrences } from "./selectors.js";
import { ACTIVE_ACTIVATION_STATUSES } from "../domain/activations.js";

function targetCard(state, block, now, timezone) {
  const progress = calculateTargetProgress({ state, block, now, timezone });
  return { id: block.id, name: block.name, period: block.typeConfig?.period?.mode || block.typeConfig?.period || "all_time", ...progress };
}

function directAvoidActionItems(state, now, timezone) {
  const output = [];
  for (const block of (state.blocks || []).filter((item) => item.status === "active" && item.type === "action_list")) {
    for (const relationship of block.children || []) {
      if (relationship.kind !== "action") continue;
      const action = getActionById(state, relationship.refId);
      if (!action || action.direction !== "avoid") continue;
      const evaluation = normalizeAvoidEvaluation(relationship.avoidEvaluation || block.typeConfig?.avoidEvaluation || { mode: "binary_limit", metric: action.avoidMetricHint || (action.completion?.method === "time" ? "time" : "count"), binaryLimit: 0, period: { mode: "day" } });
      const result = evaluateAvoidActionPeriod({ logs: state.actionLogs, actionId: action.id, evaluation, now, timezone });
      output.push({ id: `${block.id}:${action.id}`, actionId: action.id, blockId: block.id, relationshipId: relationship.id, name: action.name, contextName: block.name, ...result });
    }
  }
  return output;
}

function currentCycleChoices(state) {
  const choices = [];
  for (const block of (state.blocks || []).filter((item) => item.type === "cycle" && item.status === "active")) {
    const activation = (state.activations || []).find((item) => item.blockId === block.id && ACTIVE_ACTIVATION_STATUSES.includes(item.status) && item.status !== "paused");
    if (!activation) continue;
    const sequence = activation.roundSnapshot || distributeCycleFrequency(block.children || []);
    const next = resolveNextEligibleItem(sequence, activation.cycleState || activation, () => true, block.typeConfig?.eligibilityMode || "next_eligible");
    if (next) choices.push({ kind: "cycle", blockId: block.id, blockName: block.name, relationshipId: next.item.id, refId: next.item.refId, refKind: next.item.kind, label: next.item.kind === "action" ? getActionById(state, next.item.refId)?.name : getBlockById(state, next.item.refId)?.name });
  }
  return choices;
}

export function getHomeViewModel(state, { now, timezone }) {
  const running = getRunningRuns(state).map((run) => ({ ...run, block: getBlockById(state, run.blockId) }));
  const dueAll = getDueOccurrences(state, now);
  const overdue = dueAll.filter((item) => item.status === "overdue");
  const dueNow = dueAll.filter((item) => ["due", "partial", "available"].includes(item.status));
  const cycles = currentCycleChoices(state);
  const positiveTargets = (state.blocks || []).filter((block) => block.type === "target" && block.status === "active" && block.direction !== "avoid");
  const today = positiveTargets.filter((block) => (block.typeConfig?.period?.mode || block.typeConfig?.period) === "day").map((block) => targetCard(state, block, now, timezone));
  const thisWeek = positiveTargets.filter((block) => (block.typeConfig?.period?.mode || block.typeConfig?.period) === "week").map((block) => targetCard(state, block, now, timezone));
  const avoidBlocks = (state.blocks || []).filter((block) => block.status === "active" && block.direction === "avoid").map((block) => ({ id: block.id, name: block.name, ...evaluateAvoidPeriod({ state, block, now, timezone }) }));
  const avoid = [...avoidBlocks, ...directAvoidActionItems(state, now, timezone)];
  const project = state.settings?.primaryProjectId ? getBlockById(state, state.settings.primaryProjectId) : null;
  let nowChoices = [];
  if (running.length) nowChoices = running.map((item) => ({ kind: "run", id: item.id, label: item.block?.name || item.blockNameSnapshot }));
  else if (overdue.length) nowChoices = overdue.map((item) => ({ kind: "occurrence", id: item.id, label: item.actionName }));
  else if (dueNow.length) nowChoices = dueNow.map((item) => ({ kind: "occurrence", id: item.id, label: item.actionName }));
  else if (cycles.length) nowChoices = cycles;
  else {
    const approaching = [...today, ...thisWeek].filter((item) => !item.reached && item.actual > 0).sort((a, b) => b.percentage - a.percentage);
    nowChoices = approaching.slice(0, approaching.length && approaching[0].percentage === approaching[1]?.percentage ? 2 : 1).map((item) => ({ kind: "target", id: item.id, label: item.name }));
  }
  const recentActionIds = [...(state.actionLogs || [])].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map((item) => item.actionId);
  const quickLog = [...new Set(recentActionIds.concat((state.actions || []).filter((item) => item.status === "active").map((item) => item.id)))].map((id) => getActionById(state, id)).filter(Boolean);
  return { now, nowChoices, running, due: { overdue, dueNow, laterToday: [] }, avoid, today, thisWeek, currentProject: project, upcoming: getUpcomingOccurrences(state, now, 5), quickLog };
}
