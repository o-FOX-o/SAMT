import { aggregateLogsUnique } from "../domain/logs.js";
import { analyzeResultValues } from "../domain/results.js";
import { getUniqueLogsForBlock } from "./selectors.js";

export function getAnalysisViewModel({ state, from = null, to = null, blockId = null, inclusive = true, actionId = null, resultFieldId = null } = {}) {
  const inRange = (log) => (!from || new Date(log.eventAt) >= new Date(from)) && (!to || new Date(log.eventAt) < new Date(to)) && (!actionId || log.actionId === actionId);
  const logs = blockId ? getUniqueLogsForBlock(state, blockId, inclusive).filter(inRange) : aggregateLogsUnique(state.actionLogs || [], inRange);
  const totalMinutes = logs.reduce((sum, log) => sum + Number(log.durationMinutes || 0), 0); const result = resultFieldId ? analyzeResultField(state, resultFieldId, logs) : null;
  return { scope: blockId ? (inclusive ? "INCLUSIVE_UNIQUE" : "DIRECT") : "GLOBAL_UNIQUE", logs, logCount: logs.length, totalMinutes, result };
}

function analyzeResultField(state, id, logs) { for (const action of state.actions || []) { const field = (action.resultFields || []).find((candidate) => candidate.id === id); if (field) return analyzeResultValues({ field, values: logs.flatMap((log) => (log.resultValues || []).filter((entry) => entry.fieldId === id).map((entry) => entry.value)), units: state.units || [] }); } return null; }
