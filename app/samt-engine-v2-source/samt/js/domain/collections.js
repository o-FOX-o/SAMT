export function collectionRuntimeView(block, children) {
  return { blockId: block.id, name: block.name, description: block.description || "", type: "collection", completion: null, schedule: null, children: children || [] };
}
