export const NAV_ITEMS = [
  ["home", "Home", "⌂"], ["actions", "Actions", "✓"], ["blocks", "Blocks", "▦"], ["cycles", "Cycles", "↻"],
  ["todo", "To-do", "☷"], ["projects", "Projects", "▣"], ["reviews", "Reviews", "↺"], ["analysis", "Analysis", "◒"],
  ["history", "History", "◷"], ["capacity", "Capacity", "◫"], ["settings", "Settings", "⚙"]
];

export const BLOCK_LABELS = { collection: "Collection", action_list: "Action List", routine: "Routine", workflow: "Workflow", project: "Project", cycle: "Cycle", target: "Target" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
export const attr = (value) => esc(value).replace(/\n/g, "&#10;");
export const titleCase = (value) => String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const typeLabel = (type) => BLOCK_LABELS[type] || titleCase(type);
export const statusLabel = (status) => titleCase(status || "unknown");
export const fmtMinutes = (value) => { const minutes = Math.max(0, Math.round(Number(value) || 0)); const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours && rest ? `${hours}h ${rest}m` : hours ? `${hours}h` : `${rest}m`; };
export const fmtDate = (value) => { if (!value) return "—"; const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date) : "—"; };
export const fmtDateTime = (value) => { if (!value) return "—"; const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date) : "—"; };
export const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(0)}%` : "—";
export const actionById = (state, id) => (state.actions || []).find((action) => action.id === id) || null;
export const blockById = (state, id) => (state.blocks || []).find((block) => block.id === id) || null;
export const relationshipLabel = (state, relationship) => relationship?.label || (relationship?.kind === "action" ? actionById(state, relationship.refId)?.name : blockById(state, relationship?.refId)?.name) || "Untitled";
export const actionLogsFor = (state, actionId) => (state.actionLogs || []).filter((log) => log.actionId === actionId).sort((a, b) => new Date(b.eventAt) - new Date(a.eventAt));
export const parseRoute = (path) => { const raw = String(path || "/home").replace(/^#/, ""); const [pathname, queryString = ""] = raw.split("?"); const clean = pathname.replace(/\/+$/, "") || "/home"; const parts = clean.split("/").filter(Boolean).map((part) => decodeURIComponent(part)); return { path: clean, section: parts[0] || "home", id: parts[1] || null, mode: parts[2] || null, query: Object.fromEntries(new URLSearchParams(queryString)) }; };
export function formValue(form, name, fallback = "") { const value = new FormData(form).get(name); return value == null ? fallback : String(value); }
export function formChecked(form, name) { return new FormData(form).get(name) === "on"; }
export function setFlashMessage(message, level = "success") { return { message: String(message || ""), level }; }
