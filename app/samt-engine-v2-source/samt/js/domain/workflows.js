export function calculateWorkflowProgress({ block, childStates }) {
  const states = new Map((childStates || []).map((item) => [item.relationshipId, item]));
  const children = [...(block.children || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const currentIndex = children.findIndex((child) => !states.get(child.id)?.completed);
  return { total: children.length, completed: currentIndex < 0 ? children.length : currentIndex, currentRelationshipId: currentIndex < 0 ? null : children[currentIndex].id, finished: children.length > 0 && currentIndex < 0 };
}
