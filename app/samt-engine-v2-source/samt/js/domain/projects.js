export function calculateProjectProgress({ block, childStates, targetResults = [] }) {
  const required = new Set((block.completion && block.completion.requiredRelIds) || []);
  const completed = new Set((childStates || []).filter((item) => item.completed).map((item) => item.relationshipId));
  const requiredReached = [...required].every((id) => completed.has(id));
  const targetsReached = (targetResults || []).every((item) => item.reached);
  const total = (block.children || []).length;
  return { completedChildren: completed.size, totalChildren: total, percentage: total ? (completed.size / total) * 100 : 0, requiredReached, targetsReached, complete: requiredReached && targetsReached };
}
