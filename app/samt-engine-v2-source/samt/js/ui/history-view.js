import { escapeHtml, formatDateTime, titleCase } from "./format.js";

export function renderHistoryView(history) {
  const sorted = [...history].sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt));
  return `<main class="page-shell"><header class="page-head"><div class="page-head-copy"><span class="eyebrow">Factual ledger</span><h1>History</h1><p class="muted">Facts and lifecycle evaluations. Analysis reads these records.</p></div></header><section class="card">${sorted.length ? sorted.map((item) => `<article class="row"><div class="row-main"><strong class="row-title">${escapeHtml(item.nameSnapshot || titleCase(item.event || item.type))}</strong><div class="row-meta"><span>${escapeHtml(titleCase(item.event || item.type))}</span><span>${escapeHtml(formatDateTime(item.timestamp || item.createdAt))}</span></div></div></article>`).join("") : '<div class="empty">History is empty.</div>'}</section></main>`;
}
