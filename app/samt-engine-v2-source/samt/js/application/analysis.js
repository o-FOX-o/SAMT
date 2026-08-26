import { aggregateLogsUnique, globalUniqueTime } from "../domain/logs.js";
import { getDescendantActionIds } from "../domain/relationships.js";
import { calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidPeriod } from "../domain/avoid.js";

export function getAnalysisViewModel(state, { now, timezone, bounds = null, blockId = null } = {}) {
  const logs = state.actionLogs || [];
  const global = {
    uniqueTime: globalUniqueTime(logs, bounds),
    actionLogs: aggregateLogsUnique(logs, { metric: "count", bounds }).count,
    completedOccurrences: (state.occurrences || []).filter((item) => item.status === "completed" && (!bounds || (!bounds.start || item.completedAt >= bounds.start) && (!bounds.end || item.completedAt < bounds.end))).length,
    completedRuns: (state.runs || []).filter((item) => item.status === "completed" && (!bounds || (!bounds.start || item.endAt >= bounds.start) && (!bounds.end || item.endAt < bounds.end))).length
  };
  const blockRows = (state.blocks || []).map((block) => {
    const actionIds = getDescendantActionIds(state, block.id);
    const aggregate = aggregateLogsUnique(logs, { metric: "time", actionIds, bounds });
    return { id: block.id, name: block.name, type: block.type, direction: block.direction || "do", attributedTime: aggregate.actual, activityCount: aggregate.count };
  });
  const targets = (state.blocks || []).filter((block) => block.type === "target" && block.direction !== "avoid").map((block) => calculateTargetProgress({ state, block, now, timezone }));
  const avoid = (state.blocks || []).filter((block) => block.direction === "avoid").map((block) => evaluateAvoidPeriod({ state, block, now, timezone }));
  return { generatedAt: now, global, blocks: blockId ? blockRows.filter((item) => item.id === blockId) : blockRows, targets, avoid };
}
