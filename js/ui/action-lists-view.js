import { actionById, blockById, esc, fmtDateTime, statusLabel } from "./helpers.js";

const TERMINAL_OCCURRENCES = ["completed", "skipped", "missed", "expired", "excused", "not_applicable"];

function relationshipFor(state, occurrence) {
  return (state.blocks || []).flatMap((block) => block.relationships || [])
    .find((candidate) => candidate.id === occurrence.relationshipId) || null;
}

function relationshipName(state, occurrence) {
  const relationship = relationshipFor(state, occurrence);
  return relationship?.label || actionById(state, relationship?.refId)?.name
    || blockById(state, relationship?.refId)?.name || "Scheduled item";
}

function occurrenceCard(state, occurrence) {
  const relationship = relationshipFor(state, occurrence);
  const canSkip = relationship?.config?.allowSkip === true;
  const canCompleteManually = relationship?.config?.manualCompletion === true;
  const terminal = TERMINAL_OCCURRENCES.includes(occurrence.status);
  return `<article class="samt-card"><div class="samt-card-head"><div><h2>${esc(relationshipName(state, occurrence))}</h2><span class="samt-badge">${esc(statusLabel(occurrence.status))}</span></div><small>${esc(fmtDateTime(occurrence.scheduledAt || occurrence.availableFrom))}</small></div><p class="samt-muted">${esc(occurrence.snapshot?.schedule?.mode || "manual")} · ${occurrence.deadline ? `deadline ${esc(fmtDateTime(occurrence.deadline))}` : "no deadline"}</p><div class="samt-card-actions">${!terminal ? `<button class="samt-button primary" data-action="log-occurrence" data-id="${esc(occurrence.id)}">＋ Log</button>${canCompleteManually ? `<button class="samt-button ghost" data-action="complete-occurrence" data-id="${esc(occurrence.id)}">Complete manually</button>` : ""}${canSkip ? `<button class="samt-button ghost" data-action="skip-occurrence" data-id="${esc(occurrence.id)}" data-require-reason="${relationship?.config?.requireSkipReason === true ? "true" : "false"}">Skip</button>` : ""}` : ""}</div></article>`;
}

function classifyOccurrences(state, occurrences, now = new Date()) {
  const groups = { overdue: [], available: [], upcoming: [], recent: [] };
  for (const occurrence of occurrences) {
    if (TERMINAL_OCCURRENCES.includes(occurrence.status)) {
      groups.recent.push(occurrence);
      continue;
    }
    const deadline = occurrence.deadline ? new Date(occurrence.deadline) : null;
    const availableFrom = occurrence.availableFrom ? new Date(occurrence.availableFrom) : null;
    if (occurrence.status === "overdue" || deadline && Number.isFinite(deadline.getTime()) && deadline <= now) groups.overdue.push(occurrence);
    else if (!availableFrom || !Number.isFinite(availableFrom.getTime()) || availableFrom <= now) groups.available.push(occurrence);
    else groups.upcoming.push(occurrence);
  }
  groups.recent.sort((a, b) => new Date(b.updatedAt || b.resolvedAt || b.scheduledAt || 0) - new Date(a.updatedAt || a.resolvedAt || a.scheduledAt || 0));
  return groups;
}

function occurrenceSection(state, title, rows) {
  return `<section class="samt-card"><div class="samt-card-head"><h2>${title}</h2><span class="samt-count">${rows.length}</span></div><div class="samt-card-grid compact">${rows.length ? rows.map((occurrence) => occurrenceCard(state, occurrence)).join("") : `<p class="samt-empty">No records.</p>`}</div></section>`;
}

export function renderActionListsView({ state = {} } = {}) {
  const lists = (state.blocks || []).filter((block) => block.type === "action_list");
  const relationshipIds = new Set(lists.flatMap((block) => (block.relationships || []).map((relationship) => relationship.id)));
  const occurrences = (state.occurrences || []).filter((occurrence) => relationshipIds.has(occurrence.relationshipId));
  const groups = classifyOccurrences(state, occurrences, new Date());
  const tasks = [...(state.tasks || []), ...(state.quickTasks || [])].filter((task) => task.status !== "completed");
  return `<section class="samt-page" aria-labelledby="todo-title"><header class="samt-page-head"><div><p class="samt-eyebrow">Occurrences · tasks · schedules</p><h1 id="todo-title">To-do</h1><p class="samt-muted">Action Lists generate occurrences; each occurrence is completed by qualifying Action Logs unless manual completion is explicitly enabled.</p></div><div class="samt-card-actions"><button class="samt-button primary" data-action="new-quick-task">＋ Quick task</button><a class="samt-button ghost" href="#/blocks?type=action_list">Manage Action Lists</a></div></header><div class="samt-section-grid">${occurrenceSection(state, "Overdue", groups.overdue)}${occurrenceSection(state, "Available / Due Now", groups.available)}${occurrenceSection(state, "Upcoming", groups.upcoming)}${occurrenceSection(state, "Recent", groups.recent.slice(0, 12))}</div><article class="samt-card"><div class="samt-card-head"><h2>Action Lists</h2><span class="samt-count">${lists.length}</span></div><div class="samt-list">${lists.length ? lists.map((block) => `<div class="samt-list-row"><div><a href="#/blocks/${encodeURIComponent(block.id)}"><strong>${esc(block.name)}</strong></a><small>${(block.relationships || []).length} relationships · ${esc(statusLabel(block.definitionStatus))}</small></div><a class="samt-button ghost small" href="#/blocks/${encodeURIComponent(block.id)}/edit">Edit</a></div>`).join("") : `<p class="samt-empty">No Action Lists yet.</p>`}</div></article><article class="samt-card"><div class="samt-card-head"><h2>Open tasks</h2><span class="samt-count">${tasks.length}</span></div><div class="samt-list">${tasks.length ? tasks.map((task) => `<div class="samt-list-row"><div><strong>${esc(task.name)}</strong><small>${esc(task.targetDate || task.date || "No date")}</small></div><button class="samt-button small" data-action="complete-task" data-kind="${task.id?.startsWith("quick") ? "quick" : "task"}" data-id="${esc(task.id)}">Done</button></div>`).join("") : `<p class="samt-empty">No open tasks.</p>`}</div></article></section>`;
}
