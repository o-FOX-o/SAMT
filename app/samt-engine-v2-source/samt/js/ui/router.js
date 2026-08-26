export const ROUTES = Object.freeze({
  HOME: "/",
  ACTION_LISTS: "/action-lists",
  BLOCKS: "/blocks",
  ACTIONS: "/actions",
  ANALYSIS: "/analysis",
  HISTORY: "/history",
  SETTINGS: "/settings"
});

export function parseRoute(hash = globalThis.location?.hash || "#/") {
  const raw = hash.replace(/^#/, "") || "/";
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "blocks" && parts[1]) return { name: parts[2] === "edit" ? "block-edit" : "block-detail", path: raw, id: decodeURIComponent(parts[1]) };
  if (parts[0] === "actions" && parts[1]) return { name: "action-detail", path: raw, id: decodeURIComponent(parts[1]) };
  const names = { "/": "home", "/action-lists": "action-lists", "/blocks": "blocks", "/actions": "actions", "/analysis": "analysis", "/history": "history", "/settings": "settings" };
  return { name: names[raw] || "not-found", path: raw };
}

export function navigate(path) { globalThis.location.hash = `#${path}`; }

export function routeForBlock(id, edit = false) { return `/blocks/${encodeURIComponent(id)}${edit ? "/edit" : ""}`; }
export function routeForAction(id) { return `/actions/${encodeURIComponent(id)}`; }
