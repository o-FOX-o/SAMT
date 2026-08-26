import { NotFoundError } from "../shared/errors.js";
import { calculateTargetDirectAndInclusive, calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidPeriod } from "../domain/avoid.js";
import { distributeCycleFrequency, getCurrentCyclePosition } from "../domain/cycles.js";
import { collectionRuntimeView } from "../domain/collections.js";
import { getActionById, getBlockById, getChildren, getActions, getBlocks, getActiveBlocks, getRunningRuns, getDueOccurrences, getUpcomingOccurrences } from "./selectors.js";
import { getHomeViewModel } from "./home.js";
import { getAnalysisViewModel } from "./analysis.js";
import { ACTIVE_ACTIVATION_STATUSES } from "../domain/activations.js";
import { RUNNING_RUN_STATUSES } from "../domain/runs.js";

export function createQueries(getState, getContext) {
  return {
    getState: () => getState(),
    getActionById: (id) => getActionById(getState(), id),
    getBlockById: (id) => getBlockById(getState(), id),
    getActions: (filter) => getActions(getState(), filter),
    getBlocks: (filter) => getBlocks(getState(), filter),
    getActiveBlocks: () => getActiveBlocks(getState()),
    getRunningRuns: () => getRunningRuns(getState()),
    getDueOccurrences: () => getDueOccurrences(getState(), getContext().now),
    getUpcomingOccurrences: (limit) => getUpcomingOccurrences(getState(), getContext().now, limit),
    getBlockChildren: (id) => getChildren(getState(), id),
    getBlockDetail: (id) => {
      const state = getState();
      const block = getBlockById(state, id);
      if (!block) throw new NotFoundError(`Block not found: ${id}`);
      const children = getChildren(state, id);
      if (block.type === "collection") return collectionRuntimeView(block, children);
      const periodCollection = block.direction === "avoid" ? state.avoidPeriods : state.targetPeriods;
      return { block, children, activeActivation: state.activations.find((item) => item.blockId === id && ACTIVE_ACTIVATION_STATUSES.includes(item.status)) || null, runningRun: state.runs.find((item) => item.blockId === id && RUNNING_RUN_STATUSES.includes(item.status)) || null, activePeriod: [...(periodCollection || [])].reverse().find((item) => item.blockId === id && !item.closedAt && !item.periodEnd) || null };
    },
    getTargetProgress: (id) => { const state = getState(); const block = getBlockById(state, id); return calculateTargetProgress({ state, block, ...getContext() }); },
    getTargetDirectAndInclusive: (id) => { const state = getState(); const block = getBlockById(state, id); return calculateTargetDirectAndInclusive({ state, block, ...getContext() }); },
    getAvoidStatus: (id) => { const state = getState(); const block = getBlockById(state, id); return evaluateAvoidPeriod({ state, block, ...getContext() }); },
    getCycleNextItem: (id) => {
      const state = getState(); const block = getBlockById(state, id); const activation = state.activations.find((item) => item.blockId === id && ["running", "waiting", "manual"].includes(item.status));
      const sequence = activation?.roundSnapshot || distributeCycleFrequency(block.children || []); const position = getCurrentCyclePosition(activation?.cycleState || activation || {}, sequence.length);
      return sequence[position] || null;
    },
    getHomeViewModel: () => getHomeViewModel(getState(), getContext()),
    getAnalysisViewModel: (filter) => getAnalysisViewModel(getState(), { ...getContext(), ...(filter || {}) })
  };
}
