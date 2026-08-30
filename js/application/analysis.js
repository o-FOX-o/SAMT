import { aggregateLogsUnique } from "../domain/logs.js";
import { analyzeResultValues } from "../domain/results.js";
import { getBlockDescendants } from "./selectors.js";

function boundary(value, end = false) {
  if (!value) return null;
  const date = new Date(String(value).length === 10 && end ? String(value) + "T23:59:59.999" : value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function referencesBlock(log, ids) {
  return (log.contextRefs || []).some((reference) => ids.has(reference?.blockId || reference?.blockIdRef || reference));
}

function fieldMatchesAction(action, fieldId, tagId, tags) {
  const fields = action?.resultFields || [];
  return fields.some((field) => (!fieldId || field.id === fieldId) && (!tagId || field.resultTagId === tagId));
}

function actionMatchesTaxonomy(action, categoryId, tagId, tags) {
  const actionTags = (action?.tagIds || []).map((id) => tags.find((tag) => tag.id === id)).filter(Boolean);
  const resultTags = (action?.resultFields || []).map((field) => tags.find((tag) => tag.id === field.resultTagId)).filter(Boolean);
  return (!categoryId || [...actionTags, ...resultTags].some((tag) => tag.categoryId === categoryId)) &&
    (!tagId || [...actionTags, ...resultTags].some((tag) => tag.id === tagId));
}

function targetLogFilter(state, targetId) {
  const target = (state.blocks || []).find((block) => block.id === targetId && block.type === "target");
  if (!target) return () => true;
  const config = target.config || {};
  const actionIds = new Set(config.sourceActionIds || []);
  const descendants = config.sourceBlockId ? new Set([config.sourceBlockId, ...getBlockDescendants(state, config.sourceBlockId)]) : null;
  return (log) => (!actionIds.size || actionIds.has(log.actionId)) &&
    (!descendants || referencesBlock(log, descendants));
}

function analyzeResultField(state, id, logs) {
  for (const action of state.actions || []) {
    const field = (action.resultFields || []).find((candidate) => candidate.id === id);
    if (!field) continue;
    const values = logs.flatMap((log) => (log.resultValues || []).filter((entry) => entry.fieldId === id).map((entry) => field.type === "measurement" ? entry : entry.value));
    try {
      return analyzeResultValues({ field, values, units: state.units || [] });
    } catch (error) {
      return { type: field.type, count: values.length, error: error.message };
    }
  }
  return null;
}

export function getAnalysisViewModel({
  state,
  from = null,
  to = null,
  blockId = null,
  inclusive = true,
  attribution = null,
  descendant = false,
  actionId = null,
  categoryId = null,
  tagId = null,
  blockType = null,
  runId = null,
  resultFieldId = null,
  resultTagId = null,
  targetId = null,
  targetPeriodId = null,
  view = "all"
} = {}) {
  const safeState = state || {};
  const actions = safeState.actions || [];
  const tags = safeState.tags || [];
  const selectedAction = actionId ? actions.find((action) => action.id === actionId) : null;
  const mode = attribution || (descendant ? "descendant" : (blockId ? (inclusive ? "inclusive" : "direct") : "global"));
  const descendants = blockId ? new Set(getBlockDescendants(safeState, blockId)) : new Set();
  const blockIds = blockId ? (mode === "direct" ? new Set([blockId]) : mode === "descendant" ? descendants : new Set([blockId, ...descendants])) : null;
  const targetPeriod = targetPeriodId ? (safeState.periods || []).find((period) => period.id === targetPeriodId) || (safeState.targetEvaluations || []).find((evaluation) => evaluation.id === targetPeriodId || evaluation.periodId === targetPeriodId) : null;
  const targetFilter = targetId ? targetLogFilter(safeState, targetId) : () => true;
  const start = boundary(from || targetPeriod?.start, false);
  const end = boundary(to || targetPeriod?.end, true);
  const inRange = (log) => {
    const event = new Date(log.eventAt);
    if (start && event < start || end && event > end) return false;
    if (selectedAction && log.actionId !== selectedAction.id) return false;
    const action = actions.find((candidate) => candidate.id === log.actionId) || { id: log.actionId, direction: log.actionSnapshot?.direction };
    if (!actionMatchesTaxonomy(action, categoryId, tagId, tags)) return false;
    if (blockIds && !referencesBlock(log, blockIds)) return false;
    if (blockType && !(log.contextRefs || []).some((reference) => (safeState.blocks || []).find((block) => block.id === (reference?.blockId || reference?.blockIdRef || reference))?.type === blockType)) return false;
    if (runId && !(log.contextRefs || []).some((reference) => reference?.runId === runId)) return false;
    if (!targetFilter(log)) return false;
    const values = log.resultValues || [];
    if (resultFieldId && !values.some((entry) => entry.fieldId === resultFieldId)) return false;
    if (resultTagId && !fieldMatchesAction(action, null, resultTagId, tags) && !values.some((entry) => (action.resultFields || []).find((field) => field.id === entry.fieldId)?.resultTagId === resultTagId)) return false;
    if (view === "avoid" && action.direction !== "avoid" || view === "actions" && action.direction === "avoid" || view === "results" && !values.length) return false;
    return true;
  };
  const logs = aggregateLogsUnique(safeState.actionLogs || [], inRange);
  const totalMinutes = logs.reduce((sum, log) => sum + Number(log.durationMinutes || 0), 0);
  const result = resultFieldId ? analyzeResultField(safeState, resultFieldId, logs) : null;
  const target = targetId ? (safeState.blocks || []).find((block) => block.id === targetId) || null : null;
  const targetPeriods = targetId ? (safeState.periods || []).filter((period) => period.ownerId === targetId).concat((safeState.targetEvaluations || []).filter((evaluation) => evaluation.ownerId === targetId)) : [];
  return {
    scope: mode === "global" ? "GLOBAL_UNIQUE" : mode === "direct" ? "DIRECT" : mode === "descendant" ? "DESCENDANT_UNIQUE" : "INCLUSIVE_UNIQUE",
    logs,
    logCount: logs.length,
    totalMinutes,
    result,
    target,
    targetPeriods,
    filters: { from, to, blockId, attribution: mode, actionId, categoryId, tagId, blockType, runId, resultFieldId, resultTagId, targetId, targetPeriodId, view }
  };
}
