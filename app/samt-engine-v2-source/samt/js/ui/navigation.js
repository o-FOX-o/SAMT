import { ROUTES } from "./router.js";
import { escapeHtml } from "./format.js";

export const NAVIGATION = Object.freeze([
  { id: "home", label: "Home", short: "Home", path: ROUTES.HOME },
  { id: "action-lists", label: "Action Lists", short: "Lists", path: ROUTES.ACTION_LISTS },
  { id: "blocks", label: "Blocks", short: "Blocks", path: ROUTES.BLOCKS },
  { id: "actions", label: "Actions", short: "Actions", path: ROUTES.ACTIONS },
  { id: "analysis", label: "Analysis", short: "Analysis", path: ROUTES.ANALYSIS },
  { id: "history", label: "History", short: "History", path: ROUTES.HISTORY },
  { id: "settings", label: "Settings", short: "Settings", path: ROUTES.SETTINGS }
]);

export function brandMarkup() {
  return `<a class="brand" href="#/" aria-label="SAMT Home"><svg aria-hidden="true" viewBox="0 0 64 64" width="34" height="34"><circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="32" r="15" fill="none" stroke="currentColor" stroke-width="2"/><path d="M32 5 39 26 59 32 39 38 32 59 25 38 5 32 25 26Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="32" r="4" fill="currentColor"/></svg><span>SAMT</span></a>`;
}

function isCurrent(route, item) {
  if (item.path === "/") return route.name === "home";
  return route.path === item.path || route.path.startsWith(`${item.path}/`);
}

export function desktopNavigation(route) {
  return `<nav class="desktop-nav" aria-label="Primary navigation">${NAVIGATION.map((item) => `<a class="nav-link" href="#${item.path}" ${isCurrent(route, item) ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("")}</nav>`;
}

export function mobileNavigation(route) {
  const primary = NAVIGATION.filter((item) => ["home", "action-lists", "blocks", "analysis"].includes(item.id));
  return `<nav class="mobile-nav" aria-label="Primary navigation">${primary.map((item) => `<a class="nav-link" href="#${item.path}" ${isCurrent(route, item) ? 'aria-current="page"' : ""}>${escapeHtml(item.short)}</a>`).join("")}<button type="button" class="nav-link btn-ghost" data-action="open-more">More</button></nav>`;
}

export function moreNavigationMarkup(route) {
  return `<div class="stack">${NAVIGATION.map((item) => `<a class="btn ${isCurrent(route, item) ? "btn-primary" : ""}" href="#${item.path}" data-close-modal>${escapeHtml(item.label)}</a>`).join("")}</div>`;
}
