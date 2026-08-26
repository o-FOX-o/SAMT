import { ValidationError } from "../shared/errors.js";

export function distributeCycleFrequency(children) {
  const weighted = (children || []).map((child, index) => ({ child, index, weight: Number(child.frequency ?? 1), current: 0 }));
  if (!weighted.length) return [];
  if (weighted.some((item) => !Number.isInteger(item.weight) || item.weight < 1)) throw new ValidationError("Cycle frequency must be a whole number of at least 1.");
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  const output = [];
  for (let position = 0; position < total; position += 1) {
    for (const item of weighted) item.current += item.weight;
    weighted.sort((a, b) => b.current - a.current || a.index - b.index);
    const selected = weighted[0];
    selected.current -= total;
    output.push({ ...selected.child, sourceRelationshipId: selected.child.id, generatedPosition: position });
    weighted.sort((a, b) => a.index - b.index);
  }
  return output;
}

export function getCurrentCyclePosition(cycleState, sequenceLength) {
  if (!sequenceLength) return 0;
  return Math.max(0, Math.trunc(Number(cycleState.currentPosition) || 0)) % sequenceLength;
}

export function advanceCycle(cycleState, sequenceLength) {
  if (!sequenceLength) return { ...cycleState, currentPosition: 0, currentRound: cycleState.currentRound || 1 };
  const current = getCurrentCyclePosition(cycleState, sequenceLength);
  const finishedRound = current === sequenceLength - 1;
  return { ...cycleState, currentPosition: finishedRound ? 0 : current + 1, currentRound: Math.max(1, Number(cycleState.currentRound) || 1) + (finishedRound ? 1 : 0), completedRounds: Math.max(0, Number(cycleState.completedRounds) || 0) + (finishedRound ? 1 : 0) };
}

export function applyCyclePeriodEnd(cycleState, policy = {}) {
  const positionPolicy = policy.position || policy.positionPolicy || "continue";
  return positionPolicy === "restart" || positionPolicy === "restart_from_beginning" ? { ...cycleState, currentPosition: 0 } : { ...cycleState };
}

export function applyMissedCycleItemPolicy(cycleState, sequenceLength, policy = "keep") {
  if (policy === "skip" || policy === "skip_to_next") return advanceCycle(cycleState, sequenceLength);
  if (policy === "restart" || policy === "restart_cycle") return { ...cycleState, currentPosition: 0 };
  return { ...cycleState };
}

export function resolveNextEligibleItem(sequence, cycleState, isEligible, mode = "next_eligible") {
  if (!sequence.length) return null;
  const current = getCurrentCyclePosition(cycleState, sequence.length);
  if (mode === "strict") return isEligible(sequence[current]) ? { item: sequence[current], position: current } : null;
  for (let offset = 0; offset < sequence.length; offset += 1) {
    const position = (current + offset) % sequence.length;
    if (isEligible(sequence[position])) return { item: sequence[position], position };
  }
  return null;
}
