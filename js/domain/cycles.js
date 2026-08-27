import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { finiteNumber } from "../shared/numbers.js";

export const APPEARANCE_MODES = ["fixed", "weighted"];
export const ELIGIBILITY_MODES = ["strict_order", "next_eligible"];
export const EXPIRED_POLICIES = ["keep_position", "advance_to_next", "restart_small_cycle", "restart_big_cycle"];

export function validateCycleRelationships(relationships = [], smallCycleSize = null) {
  const fixed = relationships.filter((relationship) => relationship.appearanceMode === "fixed").reduce((sum, relationship) => sum + Math.max(0, Math.floor(finiteNumber(relationship.fixedCount))), 0);
  if (smallCycleSize != null && fixed > Number(smallCycleSize)) throw new ValidationError("Small Cycle size must cover all fixed appearances.");
  for (const relationship of relationships) {
    if (!APPEARANCE_MODES.includes(relationship.appearanceMode || "fixed")) throw new ValidationError("Cycle appearance mode is invalid.");
    if (relationship.appearanceMode === "fixed" && finiteNumber(relationship.fixedCount) < 0) throw new ValidationError("Fixed Cycle count cannot be negative.");
    if (relationship.appearanceMode === "weighted" && finiteNumber(relationship.weight) <= 0) throw new ValidationError("Weighted Cycle entries need a positive weight.");
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
    const weight = Math.max(0.000001, finiteNumber(relationship.weight, 1));
    const selected = finiteNumber(fairness[relationship.id], 0);
    const score = weight - selected;
    if (score > bestScore || score === bestScore && String(relationship.id) < String(best?.id || "~")) { best = relationship; bestScore = score; }
  }
  return best;
}

export function distributeExactFrequency(relationships = []) {
  const items = relationships.map((relationship) => relationship.id); const counts = relationships.map((relationship) => Math.max(0, Math.floor(finiteNumber(relationship.frequency ?? relationship.fixedCount, 0))));
  return exactSequence(items, counts, counts.reduce((sum, count) => sum + count, 0));
}

export function generateSmallCycle({ relationships = [], size = null, fairness = {}, previousCoverage = [], now = new Date() } = {}) {
  validateCycleRelationships(relationships, size);
  const fixed = relationships.filter((relationship) => (relationship.appearanceMode || "fixed") === "fixed");
  const weighted = relationships.filter((relationship) => relationship.appearanceMode === "weighted");
  const slots = size == null ? fixed.reduce((sum, relationship) => sum + Math.max(0, Math.floor(finiteNumber(relationship.fixedCount, relationship.frequency || 0))), 0) : Math.max(0, Math.floor(size));
  const fixedIds = exactSequence(fixed.map((relationship) => relationship.id), fixed.map((relationship) => Math.max(0, Math.floor(finiteNumber(relationship.fixedCount, relationship.frequency || 0)))), slots);
  const result = fixedIds.map((relationshipId, index) => ({ slot: index, relationshipId, mode: "fixed" }));
  const remaining = Math.max(0, slots - result.length); const fairnessNext = { ...fairness };
  for (let i = 0; i < remaining; i += 1) { const choice = chooseWeighted(weighted, fairnessNext); if (!choice) break; const slot = result.length; result.push({ slot, relationshipId: choice.id, mode: "weighted" }); fairnessNext[choice.id] = finiteNumber(fairnessNext[choice.id], 0) + 1; }
  // A deterministic stable ordering avoids grouped fixed entries when weighted slots exist.
  result.sort((a, b) => a.slot - b.slot);
  return { id: createId("small_cycle", now), size: result.length, slots: result, participantIds: [...new Set(result.map((entry) => entry.relationshipId))], fairness: fairnessNext, coverage: [...new Set([...(previousCoverage || []), ...result.map((entry) => entry.relationshipId)])], generatedAt: new Date(now).toISOString() };
}

export function createBigCycleRuntime({ cycleId, relationships = [], smallCycleSize, fairness = {}, now = new Date(), config = {} } = {}) {
  return { id: createId("big_cycle", now), cycleId, status: "open", participantRelationshipIds: relationships.filter((relationship) => relationship.active !== false).map((relationship) => relationship.id), smallCycleSize, fairness: clone(fairness) || {}, appearanceCoverage: [], completionCoverage: [], smallCycles: [], config: clone(config) || {}, startedAt: new Date(now).toISOString(), completedAt: null };
}

export function generateNextSmallCycle({ bigCycle, relationships = [], now = new Date() } = {}) {
  const small = generateSmallCycle({ relationships: relationships.filter((relationship) => bigCycle.participantRelationshipIds.includes(relationship.id)), size: bigCycle.smallCycleSize, fairness: bigCycle.fairness, previousCoverage: bigCycle.appearanceCoverage, now });
  return { ...small, bigCycleId: bigCycle.id, smallCycleNumber: bigCycle.smallCycles.length + 1 };
}

export function recordCycleResolution({ bigCycle, smallCycle, relationshipId, outcome = "completed" } = {}) {
  const appearanceCoverage = [...new Set([...(bigCycle.appearanceCoverage || []), relationshipId])];
  const completionCoverage = outcome === "completed" ? [...new Set([...(bigCycle.completionCoverage || []), relationshipId])] : [...(bigCycle.completionCoverage || [])];
  const updated = { ...bigCycle, appearanceCoverage, completionCoverage, fairness: clone(smallCycle.fairness) || bigCycle.fairness, smallCycles: [...(bigCycle.smallCycles || []), { id: smallCycle.id, relationshipId, outcome, resolvedAt: new Date().toISOString() }] };
  if (updated.participantRelationshipIds.every((id) => appearanceCoverage.includes(id))) { updated.status = "completed"; updated.completedAt = new Date().toISOString(); }
  return updated;
}

export function isBigCycleCoverageComplete(bigCycle) { return (bigCycle.participantRelationshipIds || []).every((id) => (bigCycle.appearanceCoverage || []).includes(id)); }

export function nextCycleSlot({ smallCycle, currentSlot = -1, eligible = () => true, mode = "strict_order" } = {}) {
  const slots = smallCycle?.slots || []; if (!slots.length) return null;
  for (let i = currentSlot + 1; i < slots.length; i += 1) if (eligible(slots[i])) return slots[i];
  if (mode === "next_eligible") for (let i = 0; i <= currentSlot && i < slots.length; i += 1) if (eligible(slots[i])) return slots[i];
  return null;
}

export function resolveExpiredCycleItem({ current, policy = "keep_position", itemCount = 0 } = {}) {
  if (!itemCount) return 0;
  if (policy === "advance_to_next") return (current + 1) % itemCount;
  if (policy === "restart_small_cycle" || policy === "restart_big_cycle") return 0;
  return Math.max(0, Math.min(current, itemCount - 1));
}
