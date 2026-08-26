import { deepClone, normalizeName } from "../shared/validation.js";

const COLLECTIONS = ["categories", "tags", "units", "actions", "blocks", "activationPresets", "styles"];

function sameContent(a, b) {
  const clean = (value) => {
    const copy = deepClone(value);
    delete copy.updatedAt;
    return copy;
  };
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b));
}

export function planImportConflicts(state, pkg) {
  const entries = [];
  for (const key of COLLECTIONS) {
    const local = state[key] || [];
    for (const incoming of pkg.data[key] || []) {
      const byId = local.find((item) => item.id === incoming.id);
      const incomingName = normalizeName(incoming.name);
      const byName = incomingName ? local.find((item) => normalizeName(item.name).toLowerCase() === incomingName.toLowerCase()) : null;
      if (byId) entries.push({ collection: key, incomingId: incoming.id, localId: byId.id, conflictType: sameContent(byId, incoming) ? "same_id_same" : "same_id_changed", resolution: sameContent(byId, incoming) ? "reuse" : "keep_mine" });
      else if (byName) entries.push({ collection: key, incomingId: incoming.id, localId: byName.id, conflictType: "same_name", resolution: "use_existing" });
      else entries.push({ collection: key, incomingId: incoming.id, localId: null, conflictType: "new", resolution: "create" });
    }
  }
  return entries;
}

export function applyConflictPlan(state, pkg, plan) {
  const next = deepClone(state);
  const idMap = new Map();
  for (const entry of plan) if (entry.localId && ["reuse", "keep_mine", "use_existing", "replace_existing"].includes(entry.resolution)) idMap.set(entry.incomingId, entry.localId);
  const remap = (id) => idMap.get(id) || id;
  for (const key of COLLECTIONS) {
    for (const incomingValue of pkg.data[key] || []) {
      const entry = plan.find((item) => item.collection === key && item.incomingId === incomingValue.id);
      if (!entry || ["reuse", "keep_mine", "use_existing"].includes(entry.resolution)) continue;
      let incoming = deepClone(incomingValue);
      incoming.id = remap(incoming.id);
      if (key === "tags") incoming.categoryId = remap(incoming.categoryId);
      if (key === "actions") {
        incoming.tagIds = (incoming.tagIds || []).map(remap);
        incoming.result = { ...(incoming.result || {}), unitId: incoming.result?.unitId ? remap(incoming.result.unitId) : null, allowedUnitIds: (incoming.result?.allowedUnitIds || []).map(remap) };
      }
      if (key === "blocks") {
        incoming.children = (incoming.children || []).map((child) => ({ ...child, refId: remap(child.refId) }));
        const avoidEvaluation = incoming.typeConfig?.avoidEvaluation ? {
          ...incoming.typeConfig.avoidEvaluation,
          requiredChildBlockIds: (incoming.typeConfig.avoidEvaluation.requiredChildBlockIds || []).map(remap),
          childWeights: Object.fromEntries(Object.entries(incoming.typeConfig.avoidEvaluation.childWeights || {}).map(([id, value]) => [remap(id), value]))
        } : undefined;
        incoming.typeConfig = { ...(incoming.typeConfig || {}), requiredChildBlockIds: (incoming.typeConfig?.requiredChildBlockIds || []).map(remap), ...(avoidEvaluation ? { avoidEvaluation } : {}) };
        incoming.projectTargets = (incoming.projectTargets || []).map((target) => ({ ...target, actionId: target.actionId ? remap(target.actionId) : null, blockId: target.blockId ? remap(target.blockId) : null, unitId: target.unitId ? remap(target.unitId) : null }));
      }
      if (key === "activationPresets") incoming.blockId = remap(incoming.blockId);
      const existingIndex = next[key].findIndex((item) => item.id === incoming.id);
      if (existingIndex >= 0) next[key][existingIndex] = { ...next[key][existingIndex], ...incoming, id: next[key][existingIndex].id };
      else next[key].push(incoming);
    }
  }
  return { state: next, idMap: Object.fromEntries(idMap) };
}
