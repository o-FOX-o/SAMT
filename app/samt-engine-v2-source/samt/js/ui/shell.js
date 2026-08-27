import { brandMarkup, desktopNavigation, mobileNavigation } from "./navigation.js";

export function renderShell(route, content, { storageStatus = null } = {}) {
  const storageNotice = storageStatus?.persistent === false
    ? '<aside class="storage-notice" role="status"><strong>Temporary session mode.</strong> This browser is blocking permanent storage. SAMT still works, but export a Full Backup before closing this page.</aside>'
    : "";
  return `<div class="app-shell"><header class="app-header">${brandMarkup()}${desktopNavigation(route)}<div class="header-actions"><button class="btn btn-primary btn-small" data-action="quick-log">+ Log</button></div></header>${storageNotice}${content}${mobileNavigation(route)}</div>`;
}
