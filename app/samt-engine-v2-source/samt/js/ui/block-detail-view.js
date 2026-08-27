import { badge, escapeHtml, formatDateTime, formatMetric, titleCase } from "./format.js";

const OPEN_OCCURRENCE_STATES = new Set(["upcoming", "available", "due", "overdue", "partial", "paused"]);

function childRows(detail) {
  const children = detail.children || [];
  if (!children.length) return '<div class="empty">This Block has no children yet.</div>';
  return children.map(({ relationship, object }) => `<article class="row"><div class="row-main"><strong class="row-title">${escapeHtml(object.name)}</strong><div class="row-meta"><span>${escapeHtml(titleCase(relationship.kind))}</span>${relationship.frequency ? `<span>Frequency ${escapeHtml(relationship.frequency)}</span>` : ""}${relationship.required ? "<span>Required</span>" : ""}</div></div>${relationship.kind === "block" ? `<a class="btn btn-small" href="#/blocks/${encodeURIComponent(object.id)}">Open</a>` : `<div class="inline"><a class="btn btn-small" href="#/actions/${encodeURIComponent(object.id)}">Open</a><button class="btn btn-primary btn-small" data-action="log-action" data-id="${escapeHtml(object.id)}">Log</button></div>`}</article>`).join("");
}

function occurrenceRows(detail) {
  const occurrences = [...(detail.occurrences || [])].sort((a, b) => Date.parse(b.availableAt || b.createdAt || 0) - Date.parse(a.availableAt || a.createdAt || 0));
  if (!occurrences.length) return "";
  return `<section class="card section"><div class="section-head"><h2>Occurrences</h2><span class="badge">${occurrences.length}</span></div>${occurrences.slice(0, 20).map((item) => `<article class="row"><div class="row-main"><div class="inline"><a class="row-title" href="#/actions/${encodeURIComponent(item.actionId)}">${escapeHtml(item.actionName)}</a>${badge(item.status)}</div><div class="row-meta">${item.availableAt ? `<span>Available ${escapeHtml(formatDateTime(item.availableAt, true))}</span>` : ""}${item.dueAt ? `<span>Due ${escapeHtml(formatDateTime(item.dueAt, true))}</span>` : ""}</div></div>${OPEN_OCCURRENCE_STATES.has(item.status) ? `<div class="inline"><button class="btn btn-primary btn-small" data-action="log-occurrence" data-id="${escapeHtml(item.actionId)}" data-occurrence-id="${escapeHtml(item.id)}">Log</button><button class="btn btn-ghost btn-small" data-action="skip-occurrence" data-id="${escapeHtml(item.id)}">Skip</button></div>` : ""}</article>`).join("")}</section>`;
}

function runtimeControls(detail, block) {
  const controls = [];
  if (block.type === "target") {
    const periodMode = block.direction === "avoid" ? block.typeConfig?.avoidEvaluation?.period?.mode : block.typeConfig?.period?.mode;
    if (periodMode === "session") {
      if (detail.activePeriod) controls.push(`<button class="btn btn-primary" data-action="close-period" data-id="${escapeHtml(detail.activePeriod.id)}">Finish session</button>`);
      else controls.push(`<button class="btn btn-primary" data-action="start-block" data-id="${escapeHtml(block.id)}">Start session</button>`);
    }
  } else if (["cycle", "routine", "workflow", "project"].includes(block.type)) {
    if (!detail.currentRun) controls.push(`<button class="btn btn-primary" data-action="start-block" data-id="${escapeHtml(block.id)}">Start Run</button>`);
    else if (detail.currentRun.status === "paused") controls.push(`<button class="btn btn-primary" data-action="resume-run" data-id="${escapeHtml(detail.currentRun.id)}">Resume Run</button>`);
    else controls.push(`<button class="btn" data-action="pause-run" data-id="${escapeHtml(detail.currentRun.id)}">Pause Run</button>`);
    if (detail.currentRun) controls.push(`<button class="btn" data-action="finish-run" data-id="${escapeHtml(detail.currentRun.id)}">Finish Run</button>`);
  }
  if (block.type === "cycle" && detail.activeActivation && detail.cycle?.relationship) controls.push(`<button class="btn" data-action="advance-cycle" data-id="${escapeHtml(detail.activeActivation.id)}">Advance Cycle</button>`);
  if (block.type === "project" && !detail.isPrimaryProject) controls.push(`<button class="btn" data-action="set-primary-project" data-id="${escapeHtml(block.id)}">Make Primary</button>`);
  return controls.join("");
}

function runtimeState(detail, block) {
  const sections = [];
  if (detail.currentRun) {
    const progress = detail.currentRun.progress || {};
    const completed = progress.completed ?? progress.completedChildren;
    const total = progress.total ?? progress.totalChildren;
    sections.push(`<article class="card card-plain"><div class="split"><strong>Current Run</strong>${badge(detail.currentRun.status)}</div>${completed != null && total != null ? `<p class="metric-value">${escapeHtml(completed)} <span class="muted">/ ${escapeHtml(total)} children</span></p>` : ""}<p class="muted">Started ${escapeHtml(formatDateTime(detail.currentRun.startAt))}</p></article>`);
  }
  if (block.type === "cycle" && detail.cycle) {
    sections.push(`<article class="card card-plain"><div class="split"><strong>Next Cycle item</strong>${badge(detail.activeCyclePeriod?.status || "ready")}</div><p class="metric-value">${escapeHtml(detail.cycle.object?.name || "No eligible item")}</p><p class="muted">Position ${detail.cycle.sequenceLength ? detail.cycle.position + 1 : 0} of ${detail.cycle.sequenceLength}</p></article>`);
  }
  return sections.length ? `<section class="grid-2 section">${sections.join("")}</section>` : "";
}

export function renderBlockDetailView(detail, progress = null) {
  const block = detail.block || { id: detail.blockId, type: detail.type, name: detail.name };
  if (!block?.id) return '<main class="page-shell"><div class="empty">Block not found.</div></main>';
  const controls = runtimeControls(detail, block);
  return `<main class="page-shell"><header class="page-head"><div class="page-head-copy"><span class="eyebrow">${escapeHtml(titleCase(block.type))}</span><div class="inline"><h1>${escapeHtml(block.name)}</h1>${badge(block.status)}${block.direction === "avoid" ? badge("avoid") : ""}</div><p class="muted">${escapeHtml(block.description || "Open is the runtime view. Edit changes the reusable definition.")}</p></div><div class="inline"><a class="btn" href="#/blocks/${encodeURIComponent(block.id)}/edit">Edit</a>${controls}</div></header>${runtimeState(detail, block)}${progress ? `<section class="card section"><div class="split"><h2>Current period</h2>${badge(progress.status)}</div><div class="metric-value">${escapeHtml(formatMetric(progress.actual, progress.metric))} <span class="muted">/ ${escapeHtml(formatMetric(progress.target ?? progress.limit ?? 0, progress.metric))}</span></div>${progress.percentage != null ? `<div class="progress"><span style="--progress:${Math.min(100, progress.percentage)}%"></span></div>` : ""}</section>` : ""}<section class="card section"><div class="section-head"><h2>Children</h2><span class="badge">${(detail.children || []).length}</span></div><div>${childRows(detail)}</div></section>${occurrenceRows(detail)}</main>`;
}
