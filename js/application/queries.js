import { getHomeViewModel } from "./home.js";
import { getAnalysisViewModel } from "./analysis.js";
import { getActionById, getBlockById, getBlockChildren, getBlockDescendants, getActiveBlocks, getRunningRuns, getDueOccurrences, getUpcomingOccurrences } from "./selectors.js";
import { calculateTargetProgress } from "../domain/targets.js";
import { calculatePeriodBounds } from "../shared/dates.js";
import { evaluateAvoidFromLogs } from "../domain/avoid.js";
import { buildDataManagerIndex, filterDataManagerRecords, getDefinitionImpact, buildClearDataImpact } from "./data-manager.js";
import { getRuntimeDeletionImpact } from "./data-management.js";
import { previewImport } from "../import-export/importer.js";

function targetResultField(state, target, override = null) {
  if (override) return override;
  const config = target?.config || {};
  return (state.actions || []).flatMap((action) => action.resultFields || [])
    .find((field) => field.id === config.sourceResultFieldId || config.sourceResultTagId && field.resultTagId === config.sourceResultTagId) || null;
}

function targetPeriod(state, target, at) {
  const config = target?.config || {};
  if (!config.period || ["session", "all_time"].includes(config.period)) return null;
  return calculatePeriodBounds({
    period: config.period,
    style: config.periodStyle || "calendar",
    at,
    timezone: config.timezone || state.settings?.timezone || "UTC",
    weekStartsOn: config.weekStartsOn ?? state.settings?.weekStartsOn ?? 1,
    rollingWindowDays: config.rollingWindowDays,
    customStart: config.customStart,
    customEnd: config.customEnd
  });
}

function calculateTargetProgressTree(state, targetId, options = {}, memo = new Map(), visiting = new Set(), root = true) {
  if (memo.has(targetId)) return memo.get(targetId);
  const target = getBlockById(state, targetId);
  if (!target || target.type !== "target") throw new Error(`Target not found: ${targetId}`);
  if (visiting.has(targetId)) {
    const cyclic = { targetId, reached: false, status: "INVALID", error: "Required Target dependency cycle." };
    memo.set(targetId, cyclic);
    return cyclic;
  }
  visiting.add(targetId);
  const config = target.config || {};
  const childResults = (config.requiredChildTargetIds || [])
    .map((childId) => calculateTargetProgressTree(state, childId, {}, memo, visiting, false));
  const calculationOptions = root ? options : {};
  const progress = calculateTargetProgress({
    target,
    logs: state.actionLogs || [],
    actions: state.actions || [],
    blocks: state.blocks || [],
    units: state.units || [],
    period: calculationOptions.period || targetPeriod(state, target, calculationOptions.at || clock()),
    resultField: targetResultField(state, target, calculationOptions.resultField),
    descendantBlockIds: config.descendantBlockIds || (config.sourceBlockId ? getBlockDescendants(state, config.sourceBlockId) : []),
    childResults,
    ...calculationOptions
  });
  const result = { ...progress, reached: Boolean(progress.reached || progress.status === "reached" || progress.status === "REACHED") };
  visiting.delete(targetId);
  memo.set(targetId, result);
  return result;
}

export function createQueries(repository, { clock = () => new Date() } = {}) {
  const state = () => repository.getState();
  return { getActionById: (id) => getActionById(state(), id), getBlockById: (id) => getBlockById(state(), id), getBlockChildren: (id) => getBlockChildren(state(), id), getBlockDescendants: (id) => getBlockDescendants(state(), id), getActiveBlocks: () => getActiveBlocks(state()), getRunningRuns: () => getRunningRuns(state()), getDueOccurrences: () => getDueOccurrences(state(), clock()), getUpcomingOccurrences: (limit = 5) => getUpcomingOccurrences(state(), clock(), limit), getTargetProgress: (targetId, options = {}) => calculateTargetProgressTree(state(), targetId, { ...options, at: options.at || clock() }), getAvoidStatus: (actionId, config, period = null) => evaluateAvoidFromLogs({ actionId, config, period, logs: state().actionLogs }), getHomeViewModel: (options = {}) => getHomeViewModel({ state: state(), now: options.now || clock(), timezone: options.timezone || state().settings.timezone }), getAnalysisViewModel: (options = {}) => getAnalysisViewModel({ state: state(), ...options }), getDataManagerIndex: () => buildDataManagerIndex(state()), getDataManagerRecords: (filters = {}) => { const current = state(); return filterDataManagerRecords(buildDataManagerIndex(current), { ...filters, weekStartsOn: filters.weekStartsOn ?? current.settings?.weekStartsOn }, { now: clock() }); }, getDefinitionImpact: (type, id) => getDefinitionImpact(state(), type, id), previewImport: (packageValue, options = {}) => previewImport(packageValue, { ...options, existingState: state(), now: options.now || clock() }), previewClearData: (options = {}) => buildClearDataImpact(state(), { ...options, now: options.now || clock() }), previewRuntimeDeletion: (selections = []) => getRuntimeDeletionImpact(state(), selections) };
}
