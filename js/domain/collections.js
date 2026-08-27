import { aggregateLogsUnique } from "./logs.js";
import { getDescendantBlockIds } from "./relationships.js";

export function collectionActivity({ collectionId, blocks = [], logs = [], mode = "inclusive" } = {}) {
  const ids = mode === "direct" ? [collectionId] : [collectionId, ...getDescendantBlockIds(collectionId, blocks)];
  const blockIds = new Set(ids); return aggregateLogsUnique(logs, (log) => (log.contextRefs || []).some((reference) => blockIds.has(reference.blockId)));
}
