import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";

export function createHistoryEvent({ id = null, type, timestamp = new Date(), description, objectType = null, objectId = null, metadata = {}, snapshots = {} } = {}) { return { id: id || createId("history", timestamp), type, timestamp: new Date(timestamp).toISOString(), description: String(description || type || ""), objectType, objectId, metadata: clone(metadata) || {}, snapshots: clone(snapshots) || {} }; }
export function appendHistory(history = [], event) { return [...history, createHistoryEvent(event)].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); }
