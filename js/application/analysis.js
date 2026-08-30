import { aggregateLogsUnique } from "../domain/logs.js";
import { analyzeResultValues } from "../domain/results.js";
import { isCompatible } from "../domain/units.js";
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
  const excludedRelationshipIds = new Set((target.relationships || []).filter((relationship) => relationship.config?.includeInTarget === false).map((relationship) => relationship.id));
  return (log) => (!actionIds.size || actionIds.has(log.actionId)) &&
    (!descendants || referencesBlock(log, descendants)) &&
    !(excludedRelationshipIds.size && (log.contextRefs || []).some((reference) => reference.blockId === target.id && excludedRelationshipIds.has(reference.relationshipId)));
}

function valuesForField(logs, fieldId) {
  return logs.flatMap((log) => (log.resultValues || [])
    .filter((entry) => entry.fieldId === fieldId)
    .map((entry) => entry.value));
}

function analyzeResultField(state, id, logs) {
  for (const action of state.actions || []) {
    const field = (action.resultFields || []).find((candidate) => candidate.id === id);
    if (!field) continue;
    const values = valuesForField(logs, id);
    try {
      return analyzeResultValues({ field, values, units: state.units || [] });
    } catch (error) {
      return { type: field.type, count: values.length, error: error.message };
    }
  }
  return null;
}

function analyzeResultTag(state, tagId, logs) {
  const taggedFields = (state.actions || []).flatMap((action) =>
    (action.resultFields || [])
      .filter((field) => field.resultTagId === tagId)
      .map((field) => ({ action, field, values: valuesForField(logs, field.id) }))
  ).filter((item) => item.values.length);
  const fieldAnalyses = taggedFields.map(({ action, field, values }) => {
    try {
      return { fieldId: field.id, actionId: action.id, actionName: action.name, label: field.label, type: field.type, analysis: analyzeResultValues({ field, values, units: state.units || [] }) };
    } catch (error) {
      return { fieldId: field.id, actionId: action.id, actionName: action.name, label: field.label, type: field.type, analysis: { count: values.length, error: error.message } };
    }
  });
  const measurementGroups = [];
  for (const item of taggedFields.filter((candidate) => candidate.field.type === "measurement")) {
    const configuredUnit = item.field.config?.defaultUnitId || item.values.find((value) => value && typeof value === "object" && value.unitId)?.unitId || null;
    let group = measurementGroups.find((candidate) =>
      (!candidate.unitId && !configuredUnit) || candidate.unitId && configuredUnit && isCompatible(candidate.unitId, configuredUnit, state.units || [])
    );
    if (!group) {
      group = { unitId: configuredUnit, fieldIds: [], values: [] };
      measurementGroups.push(group);
    }
    group.fieldIds.push(item.field.id);
    group.values.push(...item.values);
  }
  const groups = measurementGroups.map((group) => {
    const source = taggedFields.find((item) => item.field.id === group.fieldIds[0]);
    try {
      return {
        type: "measurement",
        fieldIds: group.fieldIds,
        analysis: analyzeResultValues({ field: source.field, values: group.values, units: state.units || [], targetUnitId: group.unitId })
      };
    } catch (error) {
      return { type: "measurement", fieldIds: group.fieldIds, analysis: { count: group.values.length, error: error.message } };
    }
  });
  return {
    tagId,
    count: taggedFields.reduce((sum, item) => sum + item.values.length, 0),
    fields: fieldAnalyses,
    groups,
    incompatibleGroups: groups.length > 1
  };
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
  const resultTag = resultTagId ? analyzeResultTag(safeState, resultTagId, logs) : null;
  const target = targetId ? (safeState.blocks || []).find((block) => block.id === targetId) || null : null;
  const targetPeriods = targetId ? (safeState.periods || []).filter((period) => period.ownerId === targetId).concat((safeState.targetEvaluations || []).filter((evaluation) => evaluation.ownerId === targetId)) : [];
  return {
    scope: mode === "global" ? "GLOBAL_UNIQUE" : mode === "direct" ? "DIRECT" : mode === "descendant" ? "DESCENDANT_UNIQUE" : "INCLUSIVE_UNIQUE",
    logs,
    logCount: logs.length,
    totalMinutes,
    result,
    resultTag,
    target,
    targetPeriods,
    filters: { from, to, blockId, attribution: mode, actionId, categoryId, tagId, blockType, runId, resultFieldId, resultTagId, targetId, targetPeriodId, view }
  };
}
