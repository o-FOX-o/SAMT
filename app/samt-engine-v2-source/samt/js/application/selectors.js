import { getBlockChildren, getDescendantBlockIds, getDescendantActionIds } from "../domain/relationships.js";
import { resolveOccurrenceStatus } from "../domain/occurrences.js";
import { RUNNING_RUN_STATUSES } from "../domain/runs.js";

export function getActionById(state, id) { return (state.actions || []).find((item) => item.id === id) || null; }
export function getBlockById(state, id) { return (state.blocks || []).find((item) => item.id === id) || null; }
export function getActions(state, { status } = {}) { return (state.actions || []).filter((item) => !status || item.status === status); }
export function getBlocks(state, { status, type } = {}) { return (state.blocks || []).filter((item) => (!status || item.status === status) && (!type || item.type === type)); }
export function getActiveBlocks(state) { return getBlocks(state, { status: "active" }); }
export function getRunningRuns(state) { return (state.runs || []).filter((item) => RUNNING_RUN_STATUSES.includes(item.status)); }
export function getChildren(state, blockId) { return getBlockChildren(state, blockId); }
export function getDescendants(state, blockId) { return { blockIds: [...getDescendantBlockIds(state, blockId)], actionIds: [...getDescendantActionIds(state, blockId)] }; }

export function getOccurrenceView(state, occurrence, now) {
  const action = getActionById(state, occurrence.actionId);
  const block = getBlockById(state, occurrence.parentBlockId || occurrence.blockId || occurrence.contextBlockId);
  return { ...occurrence, status: resolveOccurrenceStatus(occurrence, now), actionName: action?.name || occurrence.actionNameSnapshot || "Unknown Action", direction: action?.direction || "do", blockName: block?.name || occurrence.blockNameSnapshot || "" };
}

export function getDueOccurrences(state, now) {
  return (state.occurrences || []).map((item) => getOccurrenceView(state, item, now)).filter((item) => item.direction === "do" && ["due", "overdue", "partial", "available"].includes(item.status));
}

export function getUpcomingOccurrences(state, now, limit = 5) {
  return (state.occurrences || []).map((item) => getOccurrenceView(state, item, now)).filter((item) => item.direction === "do" && item.status === "upcoming").sort((a, b) => new Date(a.availableAt) - new Date(b.availableAt)).slice(0, limit);
}
