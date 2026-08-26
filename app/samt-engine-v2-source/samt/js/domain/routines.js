export function calculateRoutineProgress({ block, childStates }) {
  const states = childStates || [];
  const completeIds = new Set(states.filter((item) => item.completed).map((item) => item.relationshipId));
  const total = (block.children || []).length;
  const completed = completeIds.size;
  const config = block.completion || { mode: "manual", threshold: 0, requiredRelIds: [] };
  const requiredReached = (config.requiredRelIds || []).every((id) => completeIds.has(id));
  let thresholdReached = false;
  if (config.mode === "count") thresholdReached = completed >= Number(config.threshold || 0);
  else if (config.mode === "percentage") thresholdReached = total === 0 ? false : (completed / total) * 100 >= Number(config.threshold || 0);
  else if (config.mode === "required_only") thresholdReached = true;
  else if (config.mode === "manual") thresholdReached = Boolean(states.manualFinished);
  const satisfied = thresholdReached && requiredReached;
  return { total, completed, percentage: total ? (completed / total) * 100 : 0, requiredReached, thresholdReached, satisfied, minimumReached: satisfied, autoFinish: satisfied && config.afterThreshold === "auto" };
}
