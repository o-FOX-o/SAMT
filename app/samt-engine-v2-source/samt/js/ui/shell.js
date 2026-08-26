import { brandMarkup, desktopNavigation, mobileNavigation } from "./navigation.js";

export function renderShell(route, content) {
  return `<div class="app-shell"><header class="app-header">${brandMarkup()}${desktopNavigation(route)}<div class="header-actions"><button class="btn btn-primary btn-small" data-action="quick-log">+ Log</button></div></header>${content}${mobileNavigation(route)}</div>`;
}
