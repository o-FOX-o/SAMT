export function historyEvent({ id, type, event, objectType, objectId, nameSnapshot, description, timestamp, references = {} }) {
  return { id, type, event, objectType, objectId, nameSnapshot, description, timestamp, createdAt: timestamp, ...references };
}
