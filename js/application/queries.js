import { getHomeViewModel } from "./home.js";
import { getAnalysisViewModel } from "./analysis.js";
import { getActionById, getBlockById, getBlockChildren, getBlockDescendants, getActiveBlocks, getRunningRuns, getDueOccurrences, getUpcomingOccurrences } from "./selectors.js";
import { calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidFromLogs } from "../domain/avoid.js";

export function createQueries(repository, { clock = () => new Date() } = {}) {
  const state = () => repository.getState();
  return { getActionById: (id) => getActionById(state(), id), getBlockById: (id) => getBlockById(state(), id), getBlockChildren: (id) => getBlockChildren(state(), id), getBlockDescendants: (id) => getBlockDescendants(state(), id), getActiveBlocks: () => getActiveBlocks(state()), getRunningRuns: () => getRunningRuns(state()), getDueOccurrences: () => getDueOccurrences(state(), clock()), getUpcomingOccurrences: (limit = 5) => getUpcomingOccurrences(state(), clock(), limit), getTargetProgress: (targetId, options = {}) => { const target = getBlockById(state(), targetId); return calculateTargetProgress({ target, logs: state().actionLogs, actions: state().actions, units: state().units, ...options }); }, getAvoidStatus: (actionId, config, period = null) => evaluateAvoidFromLogs({ actionId, config, period, logs: state().actionLogs }), getHomeViewModel: (options = {}) => getHomeViewModel({ state: state(), now: options.now || clock(), timezone: options.timezone || state().settings.timezone }), getAnalysisViewModel: (options = {}) => getAnalysisViewModel({ state: state(), ...options }) };
}
