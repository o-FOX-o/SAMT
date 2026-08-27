import { normalizedKey } from "../shared/validation.js";

export function mapConflicts(existing = [], incoming = []) {
  const byId = new Map(existing.map((item) => [item.id, item])); const byName = new Map(existing.map((item) => [normalizedKey(item.name), item])); const mappings = [];
  for (const item of incoming) { if (byId.has(item.id)) mappings.push({ incomingId: item.id, existingId: item.id, reason: "same_id" }); else if (item.name && byName.has(normalizedKey(item.name))) mappings.push({ incomingId: item.id, existingId: byName.get(normalizedKey(item.name)).id, reason: "same_name" }); }
  return mappings;
}
