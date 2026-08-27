import { getDescendantBlockIds } from "../domain/relationships.js";
import { aggregateLogsUnique } from "../domain/logs.js";

export const getActionById = (state, id) => state.actions?.find((action) => action.id === id) || null;
export const getBlockById = (state, id) => state.blocks?.find((block) => block.id === id) || null;
export const getBlockChildren = (state, id) => getBlockById(state, id)?.relationships || [];
export const getBlockDescendants = (state, id) => getDescendantBlockIds(id, state.blocks || []);
export const getActiveBlocks = (state) => (state.blocks || []).filter((block) => block.definitionStatus === "ACTIVE");
export const getRunningRuns = (state) => (state.runs || []).filter((run) => run.status === "IN_PROGRESS");
export const getDueOccurrences = (state, now = new Date()) => (state?.occurrences || []).filter((occurrence) => { const terminal = ["completed", "skipped", "missed", "expired", "excused", "not_applicable"].includes(occurrence.status); if (terminal) return false; if (["due", "overdue"].includes(occurrence.status)) return true; return Boolean(occurrence.availableFrom && new Date(occurrence.availableFrom) <= new Date(now)); });
export const getUpcomingOccurrences = (state, now = new Date(), limit = 5) => (state?.occurrences || []).filter((occurrence) => occurrence.scheduledAt && new Date(occurrence.scheduledAt) > new Date(now) && !["completed", "skipped", "missed", "expired", "excused", "not_applicable"].includes(occurrence.status)).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)).slice(0, limit);
export const getUniqueLogsForBlock = (state, blockId, inclusive = true) => { const ids = new Set(inclusive ? [blockId, ...getDescendantBlockIds(blockId, state.blocks || [])] : [blockId]); return aggregateLogsUnique(state.actionLogs || [], (log) => (log.contextRefs || []).some((reference) => ids.has(reference.blockId))); };
