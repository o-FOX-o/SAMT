export * from "./router.js";
export * from "./navigation.js";
export * from "./modal-manager.js";
export * from "./home-view.js";
// blocks-view owns the V3 detail/edit renderers. The two tiny legacy files
// are retained for compatibility but are intentionally not star-exported;
// doing so would create ambiguous duplicate exports.
export * from "./blocks-view.js";
export * from "./actions-view.js";
export * from "./action-lists-view.js";
export * from "./analysis-view.js";
export * from "./history-view.js";
export * from "./settings-view.js";
export * from "./helpers.js";
export * from "./cycles-view.js";
export * from "./projects-view.js";
export * from "./reviews-view.js";
export * from "./app-shell.js";
export { renderBlockDetailView as renderLegacyBlockDetailView } from "./block-detail-view.js";
export { renderBlockEditView as renderLegacyBlockEditView } from "./block-edit-view.js";
