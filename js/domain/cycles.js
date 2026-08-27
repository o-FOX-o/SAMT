import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { finiteNumber } from "../shared/numbers.js";

export const APPEARANCE_MODES = ["fixed", "weighted"];
export const ELIGIBILITY_MODES = ["strict_order", "next_eligible"];
export const EXPIRED_POLICIES = ["keep_position", "advance_to_next", "restart_small_cycle", "restart_big_cycle"];

function cycleSettings(relationship = {}) {
  const config = relationship.config || {};
  const appearanceMode = relationship.appearanceMode || config.appearanceMode || (relationship.weight != null || config.weight != null ? "weighted" : "fixed");
  const fixedCount = relationship.fixedCount ?? config.fixedCount ?? relationship.frequency ?? config.frequency ?? (appearanceMode === "fixed" ? 1 : 0);
  return { ...config, ...relationship, appearanceMode, fixedCount: Math.max(0, Math.floor(finiteNumber(fixedCount, 0))), weight: finiteNumber(relationship.weight ?? config.weight, 1) };
}

export function normalizeCycleRelationship(relationship = {}) { return cycleSettings(relationship); }

export function validateCycleRelationships(relationships = [], smallCycleSize = null) {
  const fixed = relationships.filter((relationship) => cycleSettings(relationship).appearanceMode === "fixed").reduce((sum, relationship) => sum + cycleSettings(relationship).fixedCount, 0);
  if (smallCycleSize != null && fixed > Number(smallCycleSize)) throw new ValidationError("Small Cycle size must cover all fixed appearances.");
  for (const relationship of relationships) {
    const settings = cycleSettings(relationship);
    if (!APPEARANCE_MODES.includes(settings.appearanceMode)) throw new ValidationError("Cycle appearance mode is invalid.");
    if (settings.appearanceMode === "fixed" && settings.fixedCount < 0) throw new ValidationError("Fixed Cycle count cannot be negative.");
    if (settings.appearanceMode === "weighted" && settings.weight <= 0) throw new ValidationError("Weighted Cycle entries need a positive weight.");
  }
  return true;
}

function exactSequence(items, counts, size) {
  const total = counts.reduce((sum, count) => sum + count, 0); const slots = size ?? total;
  if (!total || !slots) return [];
  const result = []; const placed = new Array(items.length).fill(0);
  for (let position = 0; position < slots; position += 1) {
    let best = -1; let bestScore = -Infinity;
    for (let i = 0; i < items.length; i += 1) {
      if (placed[i] >= counts[i]) continue;
      const desired = (position + 1) * counts[i] / slots; const score = desired - placed[i];
      if (score > bestScore || score === bestScore && i < best) { best = i; bestScore = score; }
    }
    if (best < 0) break; result.push(items[best]); placed[best] += 1;
  }
  return result;
}

function chooseWeighted(relationships, fairness = {}) {
  let best = null; let bestScore = -Infinity;
  for (const relationship of relationships) {
    const settings = cycleSettings(relationship); const score = finiteNumber(fairness[relationship.id], 0) + settings.weight;
    if (score > bestScore || score === bestScore && String(relationship.id) < String(best?.id || "~")) { best = relationship; bestScore = score; }
  }
  return best;
}

export function distributeExactFrequency(relationships = []) {
  const items = relationships.map((relationship) => relationship.id); const counts = relationships.map((relationship) => cycleSettings(relationship).fixedCount || Math.max(0, Math.floor(finiteNumber(relationship.frequency, 0))));
  return exactSequence(items, counts, counts.reduce((sum, count) => sum + count, 0));
}

export function generateSmallCycle({ relationships = [], size = null, fairness = {}, previousCoverage = [], now = new Date() } = {}) {
  validateCycleRelationships(relationships, size);
  const fixed = relationships.filter((relationship) => cycleSettings(relationship).appearanceMode === "fixed");
  const weighted = relationships.filter((relationship) => cycleSettings(relationship).appearanceMode === "weighted");
  const fixedCounts = fixed.map((relationship) => cycleSettings(relationship).fixedCount);
  const fixedTotal = fixedCounts.reduce((sum, count) => sum + count, 0);
  const slots = size == null ? fixedTotal + (weighted.length ? weighted.length : 0) : Math.max(0, Math.floor(size));
  const remaining = Math.max(0, slots - fixedTotal); const fairnessNext = { ...fairness }; const weightedCounts = new Map(weighted.map((relationship) => [relationship.id, 0]));
  const totalWeight = weighted.reduce((sum, relationship) => sum + cycleSettings(relationship).weight, 0);
  for (let i = 0; i < remaining; i += 1) {
    const choice = chooseWeighted(weighted, fairnessNext); if (!choice) break;
    weightedCounts.set(choice.id, weightedCounts.get(choice.id) + 1);
    fairnessNext[choice.id] = finiteNumber(fairnessNext[choice.id], 0) + cycleSettings(choice).weight - totalWeight;
  }
  const allRelationships = [...fixed, ...weighted];
  const allCounts = allRelationships.map((relationship) => cycleSettings(relationship).appearanceMode === "fixed" ? cycleSettings(relationship).fixedCount : weightedCounts.get(relationship.id) || 0);
  const sequence = exactSequence(allRelationships.map((relationship) => relationship.id), allCounts, slots);
  const modeById = new Map(allRelationships.map((relationship) => [relationship.id, cycleSettings(relationship).appearanceMode]));
  const result = sequence.map((relationshipId, index) => ({ slot: index, relationshipId, mode: modeById.get(relationshipId) || "fixed" }));
  const snapshot = allRelationships.reduce((map, relationship) => { map[relationship.id] = clone(cycleSettings(relationship)); return map; }, {});
  return { id: createId("small_cycle", now), size: result.length, slots: result, participantIds: [...new Set(result.map((entry) => entry.relationshipId))], fairness: fairnessNext, coverage: [...new Set([...(previousCoverage || []), ...result.map((entry) => entry.relationshipId)])], relationshipSnapshot: snapshot, generatedAt: new Date(now).toISOString() };
}

export function createBigCycleRuntime({ cycleId, relationships = [], smallCycleSize, fairness = {}, now = new Date(), config = {} } = {}) {
  validateCycleRelationships(relationships, smallCycleSize);
  return { id: createId("big_cycle", now), cycleId, status: "open", participantRelationshipIds: relationships.filter((relationship) => relationship.active !== false).map((relationship) => relationship.id), smallCycleSize, fairness: clone(fairness) || {}, appearanceCoverage: [], completionCoverage: [], smallCycles: [], relationshipSnapshot: relationships.filter((relationship) => relationship.active !== false).reduce((map, relationship) => { map[relationship.id] = clone(cycleSettings(relationship)); return map; }, {}), config: clone(config) || {}, startedAt: new Date(now).toISOString(), completedAt: null };
}

export function generateNextSmallCycle({ bigCycle, relationships = [], now = new Date() } = {}) {
  const small = generateSmallCycle({ relationships: relationships.filter((relationship) => bigCycle.participantRelationshipIds.includes(relationship.id)), size: bigCycle.smallCycleSize, fairness: bigCycle.fairness, previousCoverage: bigCycle.appearanceCoverage, now });
  return { ...small, bigCycleId: bigCycle.id, smallCycleNumber: bigCycle.smallCycles.length + 1 };
}

export function recordCycleResolution({ bigCycle, smallCycle, relationshipId, outcome = "completed", now = new Date() } = {}) {
  const appearanceCoverage = [...new Set([...(bigCycle.appearanceCoverage || []), relationshipId])];
  const completionCoverage = outcome === "completed" ? [...new Set([...(bigCycle.completionCoverage || []), relationshipId])] : [...(bigCycle.completionCoverage || [])];
  const updated = { ...bigCycle, appearanceCoverage, completionCoverage, fairness: clone(smallCycle.fairness) || bigCycle.fairness, smallCycles: [...(bigCycle.smallCycles || []), { id: smallCycle.id, relationshipId, outcome, resolvedAt: new Date(now).toISOString() }] };
  if (updated.participantRelationshipIds.every((id) => appearanceCoverage.includes(id))) { updated.status = "completed"; updated.completedAt = new Date(now).toISOString(); }
  return updated;
}

export function resolveSmallCycle({ bigCycle, smallCycle, resolutions = [], now = new Date() } = {}) {
  let current = bigCycle;
  for (const resolution of resolutions) current = recordCycleResolution({ bigCycle: current, smallCycle, relationshipId: resolution.relationshipId, outcome: resolution.outcome || "completed", now: resolution.resolvedAt || now });
  return current;
}

export function isBigCycleCoverageComplete(bigCycle) { return (bigCycle.participantRelationshipIds || []).every((id) => (bigCycle.appearanceCoverage || []).includes(id)); }

export function nextCycleSlot({ smallCycle, currentSlot = -1, eligible = () => true, mode = "strict_order" } = {}) {
  const slots = smallCycle?.slots || []; if (!slots.length) return null;
  for (let i = currentSlot + 1; i < slots.length; i += 1) if (eligible(slots[i])) return slots[i];
  if (mode === "next_eligible") for (let i = 0; i <= currentSlot && i < slots.length; i += 1) if (eligible(slots[i])) return slots[i];
  return null;
}

export function getCurrentCyclePosition(cycle, sequence = null) {
  const items = sequence || cycle?.config?.sequence || cycle?.relationships || [];
  if (!items.length) return null;
  const index = Math.max(0, Math.min(Number(cycle?.config?.currentPosition ?? cycle?.currentPosition ?? 0), items.length - 1));
  return { index, relationshipId: items[index]?.relationshipId || items[index]?.id || null, item: items[index] || null };
}

export function advanceCyclePosition(cycle, { sequence = null, steps = 1, now = new Date() } = {}) {
  const items = sequence || cycle?.config?.sequence || cycle?.relationships || [];
  if (!items.length) return { ...cycle, config: { ...(cycle?.config || {}), currentPosition: 0 } };
  const current = Number(cycle?.config?.currentPosition ?? cycle?.currentPosition ?? 0); const next = ((current + Number(steps || 1)) % items.length + items.length) % items.length;
  return { ...cycle, config: { ...(cycle?.config || {}), currentPosition: next }, currentPosition: next, updatedAt: new Date(now).toISOString() };
}

export function resolveCycleSlot({ slot, outcome = "completed", allowSkip = false, reason = null, now = new Date() } = {}) {
  if (!slot?.relationshipId) throw new ValidationError("Cycle slot is required.");
  if (outcome === "skipped" && !allowSkip) throw new ValidationError("Skipping this Cycle relationship is not allowed.");
  if (!["completed", "skipped", "missed", "deferred", "excused", "not_applicable"].includes(outcome)) throw new ValidationError("Cycle resolution is invalid.");
  return { ...slot, outcome, reason: reason || null, resolvedAt: new Date(now).toISOString() };
}

export function resolveExpiredCycleItem({ current, policy = "keep_position", itemCount = 0 } = {}) {
  if (!itemCount) return 0;
  if (policy === "advance_to_next") return (current + 1) % itemCount;
  if (policy === "restart_small_cycle" || policy === "restart_big_cycle") return 0;
  return Math.max(0, Math.min(current, itemCount - 1));
}
