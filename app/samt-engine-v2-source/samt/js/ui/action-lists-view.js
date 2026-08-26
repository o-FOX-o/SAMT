import { renderBlocksView } from "./blocks-view.js";

export function renderActionListsView(blocks) {
  const html = renderBlocksView(blocks);
  return html.replace("<h1>Blocks</h1>", "<h1>Action Lists</h1>").replace("Cycles, routines, workflows, projects, lists, collections and targets.", "Ongoing pools that generate Action occurrences without fake overall completion.").replace('data-action="new-block"', 'data-action="new-action-list"').replace("New Block", "New Action List").replace("No Blocks yet", "No Action Lists yet");
}
