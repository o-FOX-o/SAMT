import { badge, escapeHtml, formatMetric, titleCase } from "./format.js";

function childRows(detail) {
  const children = detail.children || [];
  if (!children.length) return '<div class="empty">This Block has no children yet.</div>';
  return children.map(({ relationship, object }) => `<article class="row"><div class="row-main"><strong class="row-title">${escapeHtml(object.name)}</strong><div class="row-meta"><span>${escapeHtml(titleCase(relationship.kind))}</span>${relationship.frequency ? `<span>Frequency ${escapeHtml(relationship.frequency)}</span>` : ""}</div></div>${relationship.kind === "block" ? `<a class="btn btn-small" href="#/blocks/${encodeURIComponent(object.id)}">Open</a>` : `<div class="inline"><a class="btn btn-small" href="#/actions/${encodeURIComponent(object.id)}">Open</a><button class="btn btn-primary btn-small" data-action="log-action" data-id="${escapeHtml(object.id)}">Log</button></div>`}</article>`).join("");
}

export function renderBlockDetailView(detail, progress = null) {
  const block = detail.block || { id: detail.blockId, type: detail.type, name: detail.name };
  if (!block?.id) return '<main class="page-shell"><div class="empty">Block not found.</div></main>';
  const sessionControl = detail.activePeriod
    ? `<button class="btn btn-primary" data-action="close-period" data-id="${escapeHtml(detail.activePeriod.id)}">Finish session</button>`
    : !["collection", "action_list"].includes(block.type) ? `<button class="btn btn-primary" data-action="start-block" data-id="${escapeHtml(block.id)}">Start</button>` : "";
  return `<main class="page-shell"><header class="page-head"><div class="page-head-copy"><span class="eyebrow">${escapeHtml(titleCase(block.type))}</span><h1>${escapeHtml(block.name)}</h1><p class="muted">${escapeHtml(block.description || "Open is the runtime view. Edit changes the reusable definition.")}</p></div><div class="inline"><a class="btn" href="#/blocks/${encodeURIComponent(block.id)}/edit">Edit</a>${sessionControl}</div></header>${progress ? `<section class="card section"><div class="split"><h2>Current period</h2>${badge(progress.status)}</div><div class="metric-value">${escapeHtml(formatMetric(progress.actual, progress.metric))} <span class="muted">/ ${escapeHtml(formatMetric(progress.target ?? progress.limit ?? 0, progress.metric))}</span></div>${progress.percentage != null ? `<div class="progress"><span style="--progress:${Math.min(100, progress.percentage)}%"></span></div>` : ""}</section>` : ""}<section class="card section"><div class="section-head"><h2>Children</h2><span class="badge">${(detail.children || []).length}</span></div><div>${childRows(detail)}</div></section></main>`;
}
