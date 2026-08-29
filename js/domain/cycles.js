import { ValidationError } from "../shared/errors.js";
import { createId } from "../shared/ids.js";
import { clone } from "../shared/validation.js";
import { finiteNumber } from "../shared/numbers.js";

export const GENERATION_MODES = ["simple_ordered", "exact_frequency", "weighted_limited"];
export const APPEARANCE_MODES = ["fixed", "weighted"];
export const ELIGIBILITY_MODES = ["strict_order", "next_eligible"];
export const EXPIRED_POLICIES = ["keep_position", "advance_to_next", "restart_small_cycle", "restart_big_cycle"];

function normalizeGenerationMode(value) {
  const aliases = {
    simple: "simple_ordered",
    ordered: "simple_ordered",
    simple_order: "simple_ordered",
    exact: "exact_frequency",
    frequency: "exact_frequency",
    weighted: "weighted_limited",
    limited_weighted: "weighted_limited"
  };
  return aliases[value] || value;
}

function cycleSettings(relationship = {}) {
  const config = relationship.config || {};
  const generationMode = normalizeGenerationMode(
    relationship.generationMode || config.generationMode || relationship.cycleMode || config.cycleMode || null
  );
  const appearanceMode = relationship.appearanceMode || config.appearanceMode ||
    (relationship.weight != null || config.weight != null ? "weighted" : "fixed");
  const exactCount = relationship.exactCount ?? config.exactCount ?? relationship.frequency ?? config.frequency ?? null;
  const fixedCount = relationship.fixedCount ?? config.fixedCount ?? exactCount ?? (appearanceMode === "fixed" ? 1 : 0);
  return {
    ...config,
    ...relationship,
    generationMode,
    appearanceMode,
    exactCount: exactCount == null ? null : Math.max(0, Math.floor(finiteNumber(exactCount, 0))),
    fixedCount: Math.max(0, Math.floor(finiteNumber(fixedCount, 0))),
    weight: finiteNumber(relationship.weight ?? config.weight, 1)
  };
}

function inferGenerationMode(relationships = [], explicit = null) {
  const requested = normalizeGenerationMode(explicit || relationships.find((relationship) =>
    relationship.generationMode || relationship.config?.generationMode || relationship.cycleMode || relationship.config?.cycleMode
  )?.generationMode);
  if (requested && GENERATION_MODES.includes(requested)) return requested;
  if (relationships.some((relationship) => cycleSettings(relationship).appearanceMode === "weighted")) return "weighted_limited";
  return "exact_frequency";
}

export function normalizeCycleRelationship(relationship = {}) {
  return cycleSettings(relationship);
}

export function validateCycleRelationships(relationships = [], smallCycleSize = null, generationMode = null) {
  const mode = inferGenerationMode(relationships, generationMode);
  if (!GENERATION_MODES.includes(mode)) throw new ValidationError("Cycle generation mode is invalid.");
  const settings = relationships.map(cycleSettings);
  const fixed = settings.filter((relationship) => relationship.appearanceMode === "fixed")
    .reduce((sum, relationship) => sum + (mode === "exact_frequency" && relationship.exactCount != null ? relationship.exactCount : relationship.fixedCount), 0);
  if (smallCycleSize != null && fixed > Number(smallCycleSize)) {
    throw new ValidationError("Small Cycle size must cover all fixed appearances.");
  }
  if (mode === "simple_ordered" && smallCycleSize != null && Number(smallCycleSize) < relationships.length) {
    throw new ValidationError("Simple Ordered Small Cycle size must include every relationship.");
  }
  for (const relationship of settings) {
    if (!APPEARANCE_MODES.includes(relationship.appearanceMode)) throw new ValidationError("Cycle appearance mode is invalid.");
    if (relationship.fixedCount < 0 || (relationship.exactCount != null && relationship.exactCount < 0)) {
      throw new ValidationError("Cycle frequency cannot be negative.");
    }
    if ((mode === "weighted_limited" || relationship.appearanceMode === "weighted") && relationship.weight <= 0) {
      throw new ValidationError("Weighted Cycle entries need a positive weight.");
    }
  }
  return true;
}

function exactSequence(items, counts, size) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const slots = size ?? total;
  if (!total || !slots) return [];
  const result = [];
  const placed = new Array(items.length).fill(0);
  for (let position = 0; position < slots; position += 1) {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < items.length; i += 1) {
      if (placed[i] >= counts[i]) continue;
      const desired = (position + 1) * counts[i] / slots;
      const score = desired - placed[i];
      if (score > bestScore || score === bestScore && i < best) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) break;
    result.push(items[best]);
    placed[best] += 1;
  }
  return result;
}

function chooseWeighted(relationships, fairness = {}) {
  let best = null;
  let bestScore = -Infinity;
  for (const relationship of relationships) {
    const settings = cycleSettings(relationship);
    const score = finiteNumber(fairness[relationship.id], 0) + settings.weight;
    if (score > bestScore || score === bestScore && String(relationship.id) < String(best?.id || "~")) {
      best = relationship;
      bestScore = score;
    }
  }
  return best;
}

export function distributeExactFrequency(relationships = []) {
  const items = relationships.map((relationship) => relationship.id);
  const counts = relationships.map((relationship) => {
    const settings = cycleSettings(relationship);
    return settings.exactCount ?? settings.fixedCount ?? Math.max(0, Math.floor(finiteNumber(relationship.frequency, 0)));
  });
  return exactSequence(items, counts, counts.reduce((sum, count) => sum + count, 0));
}

export function generateSmallCycle({
  relationships = [],
  size = null,
  fairness = {},
  previousCoverage = [],
  generationMode = null,
  now = new Date()
} = {}) {
  const mode = inferGenerationMode(relationships, generationMode);
  validateCycleRelationships(relationships, size, mode);
  const active = relationships.filter((relationship) => relationship.active !== false);
  let sequence = [];
  let fairnessNext = { ...fairness };

  if (mode === "simple_ordered") {
    const ordered = active.map((relationship) => relationship.id);
    const requestedSize = size == null ? ordered.length : Math.floor(size);
    sequence = ordered.slice(0, requestedSize);
  } else if (mode === "exact_frequency") {
    const counts = active.map((relationship) => {
      const settings = cycleSettings(relationship);
      return settings.exactCount ?? settings.fixedCount ?? 0;
    });
    sequence = exactSequence(active.map((relationship) => relationship.id), counts, size);
  } else {
    const fixed = active.filter((relationship) => cycleSettings(relationship).appearanceMode === "fixed");
    const weighted = active.filter((relationship) => cycleSettings(relationship).appearanceMode === "weighted");
    const fixedCounts = fixed.map((relationship) => cycleSettings(relationship).fixedCount);
    const fixedTotal = fixedCounts.reduce((sum, count) => sum + count, 0);
    const slots = size == null ? fixedTotal + (weighted.length ? weighted.length : 0) : Math.max(0, Math.floor(size));
    const remaining = Math.max(0, slots - fixedTotal);
    const weightedCounts = new Map(weighted.map((relationship) => [relationship.id, 0]));
    const totalWeight = weighted.reduce((sum, relationship) => sum + cycleSettings(relationship).weight, 0);
    for (let i = 0; i < remaining; i += 1) {
      const choice = chooseWeighted(weighted, fairnessNext);
      if (!choice) break;
      weightedCounts.set(choice.id, weightedCounts.get(choice.id) + 1);
      fairnessNext[choice.id] = finiteNumber(fairnessNext[choice.id], 0) + cycleSettings(choice).weight - totalWeight;
    }
    const allRelationships = [...fixed, ...weighted];
    const allCounts = allRelationships.map((relationship) =>
      cycleSettings(relationship).appearanceMode === "fixed"
        ? cycleSettings(relationship).fixedCount
        : weightedCounts.get(relationship.id) || 0
    );
    sequence = exactSequence(allRelationships.map((relationship) => relationship.id), allCounts, slots);
  }

  const settingsById = new Map(active.map((relationship) => [relationship.id, cycleSettings(relationship)]));
  const result = sequence.map((relationshipId, index) => ({
    slot: index,
    relationshipId,
    mode: settingsById.get(relationshipId)?.appearanceMode || "fixed"
  }));
  const snapshot = active.reduce((map, relationship) => {
    map[relationship.id] = clone(cycleSettings(relationship));
    return map;
  }, {});
  return {
    id: createId("small_cycle", now),
    size: result.length,
    slots: result,
    participantIds: [...new Set(result.map((entry) => entry.relationshipId))],
    generationMode: mode,
    fairness: fairnessNext,
    coverage: [...new Set(previousCoverage || [])],
    relationshipSnapshot: snapshot,
    generatedAt: new Date(now).toISOString()
  };
}

export function createBigCycleRuntime({
  cycleId,
  relationships = [],
  smallCycleSize,
  fairness = {},
  now = new Date(),
  config = {},
  generationMode = null
} = {}) {
  const mode = inferGenerationMode(relationships, generationMode || config.generationMode);
  validateCycleRelationships(relationships, smallCycleSize, mode);
  return {
    id: createId("big_cycle", now),
    cycleId,
    status: "open",
    generationMode: mode,
    participantRelationshipIds: relationships.filter((relationship) => relationship.active !== false).map((relationship) => relationship.id),
    smallCycleSize,
    fairness: clone(fairness) || {},
    appearanceCoverage: [],
    completionCoverage: [],
    smallCycles: [],
    currentSmallCycleId: null,
    currentSlot: -1,
    relationshipSnapshot: relationships.filter((relationship) => relationship.active !== false).reduce((map, relationship) => {
      map[relationship.id] = clone(cycleSettings(relationship));
      return map;
    }, {}),
    config: clone(config) || {},
    startedAt: new Date(now).toISOString(),
    completedAt: null
  };
}

export function generateNextSmallCycle({ bigCycle, relationships = [], now = new Date() } = {}) {
  const small = generateSmallCycle({
    relationships: relationships.filter((relationship) => bigCycle.participantRelationshipIds.includes(relationship.id)),
    size: bigCycle.smallCycleSize,
    fairness: bigCycle.fairness,
    previousCoverage: bigCycle.appearanceCoverage,
    generationMode: bigCycle.generationMode,
    now
  });
  return { ...small, bigCycleId: bigCycle.id, smallCycleNumber: bigCycle.smallCycles.length + 1 };
}

function resolutionCountsAsAppearance(outcome) {
  return !["deferred", "unavailable"].includes(outcome);
}

export function recordCycleResolution({
  bigCycle,
  smallCycle,
  relationshipId,
  slot = null,
  outcome = "completed",
  now = new Date()
} = {}) {
  const appearanceCoverage = resolutionCountsAsAppearance(outcome)
    ? [...new Set([...(bigCycle.appearanceCoverage || []), relationshipId])]
    : [...(bigCycle.appearanceCoverage || [])];
  const completionCoverage = outcome === "completed"
    ? [...new Set([...(bigCycle.completionCoverage || []), relationshipId])]
    : [...(bigCycle.completionCoverage || [])];
  const stamp = new Date(now).toISOString();
  const resolution = {
    id: createId("cycle_resolution", now),
    smallCycleId: smallCycle?.id || null,
    slot: slot == null ? null : slot,
    relationshipId,
    outcome,
    resolvedAt: stamp
  };
  const updated = {
    ...bigCycle,
    appearanceCoverage,
    completionCoverage,
    fairness: clone(smallCycle?.fairness) || bigCycle.fairness,
    smallCycles: [...(bigCycle.smallCycles || []), resolution],
    currentSmallCycleId: smallCycle?.id || bigCycle.currentSmallCycleId || null,
    currentSlot: slot == null ? bigCycle.currentSlot ?? -1 : slot
  };
  if (updated.participantRelationshipIds.length && updated.participantRelationshipIds.every((id) => appearanceCoverage.includes(id))) {
    updated.status = "completed";
    updated.completedAt = stamp;
  }
  return updated;
}

export function resolveSmallCycle({ bigCycle, smallCycle, resolutions = [], now = new Date() } = {}) {
  let current = bigCycle;
  for (const resolution of resolutions) {
    current = recordCycleResolution({
      bigCycle: current,
      smallCycle,
      relationshipId: resolution.relationshipId,
      slot: resolution.slot ?? null,
      outcome: resolution.outcome || "completed",
      now: resolution.resolvedAt || now
    });
  }
  return current;
}

export function isBigCycleCoverageComplete(bigCycle) {
  return Boolean(bigCycle?.participantRelationshipIds?.length) &&
    bigCycle.participantRelationshipIds.every((id) => (bigCycle.appearanceCoverage || []).includes(id));
}

export function nextCycleSlot({ smallCycle, currentSlot = -1, eligible = () => true, mode = "strict_order" } = {}) {
  const slots = smallCycle?.slots || [];
  if (!slots.length) return null;
  for (let i = currentSlot + 1; i < slots.length; i += 1) if (eligible(slots[i])) return slots[i];
  if (mode === "next_eligible") {
    for (let i = 0; i <= currentSlot && i < slots.length; i += 1) if (eligible(slots[i])) return slots[i];
  }
  return null;
}

export function currentGeneratedCycleSlot(bigCycle, smallCycle = null) {
  const source = smallCycle || (bigCycle?.smallCycles || []).find((item) => item.id === bigCycle?.currentSmallCycleId);
  if (!source?.slots?.length) return null;
  const index = Math.max(-1, Math.min(Number(bigCycle?.currentSlot ?? -1), source.slots.length - 1));
  return index < 0 ? source.slots[0] : source.slots[index] || null;
}

export function advanceGeneratedCycleSlot(bigCycle, smallCycle, { steps = 1, now = new Date() } = {}) {
  if (!smallCycle?.slots?.length) return { ...bigCycle, currentSlot: -1, updatedAt: new Date(now).toISOString() };
  const current = Number(bigCycle?.currentSlot ?? -1);
  const next = Math.min(smallCycle.slots.length, current + Number(steps || 1));
  return {
    ...bigCycle,
    currentSmallCycleId: smallCycle.id,
    currentSlot: next,
    updatedAt: new Date(now).toISOString()
  };
}

export function getCurrentCyclePosition(cycle, sequence = null) {
  const items = sequence || cycle?.config?.sequence || cycle?.relationships || [];
  if (!items.length) return null;
  const index = Math.max(0, Math.min(Number(cycle?.config?.currentPosition ?? cycle?.currentPosition ?? 0), items.length - 1));
  return {
    index,
    relationshipId: items[index]?.relationshipId || items[index]?.id || null,
    item: items[index] || null
  };
}

export function advanceCyclePosition(cycle, { sequence = null, steps = 1, now = new Date() } = {}) {
  const items = sequence || cycle?.config?.sequence || cycle?.relationships || [];
  if (!items.length) return { ...cycle, config: { ...(cycle?.config || {}), currentPosition: 0 } };
  const current = Number(cycle?.config?.currentPosition ?? cycle?.currentPosition ?? 0);
  const next = ((current + Number(steps || 1)) % items.length + items.length) % items.length;
  return {
    ...cycle,
    config: { ...(cycle?.config || {}), currentPosition: next },
    currentPosition: next,
    updatedAt: new Date(now).toISOString()
  };
}

export function resolveCycleSlot({
  slot,
  outcome = "completed",
  allowSkip = false,
  reason = null,
  now = new Date()
} = {}) {
  if (!slot?.relationshipId) throw new ValidationError("Cycle slot is required.");
  if (outcome === "skipped" && !allowSkip) throw new ValidationError("Skipping this Cycle relationship is not allowed.");
  if (!["completed", "skipped", "missed", "deferred", "unavailable", "excused", "not_applicable"].includes(outcome)) {
    throw new ValidationError("Cycle resolution is invalid.");
  }
  return {
    ...slot,
    outcome,
    reason: reason || null,
    resolvedAt: new Date(now).toISOString()
  };
}

export function resolveExpiredCycleItem({ current, policy = "keep_position", itemCount = 0 } = {}) {
  if (!itemCount) return 0;
  if (policy === "advance_to_next") return (current + 1) % itemCount;
  if (policy === "restart_small_cycle" || policy === "restart_big_cycle") return 0;
  return Math.max(0, Math.min(current, itemCount - 1));
}
