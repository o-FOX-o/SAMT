import { actionById, blockById, esc, fmtDateTime, fmtMinutes, pct, statusLabel, typeLabel } from "./helpers.js";

function occurrenceName(state, occurrence) {
  const relationship = (state.blocks || []).flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId);
  return relationship?.label || actionById(state, relationship?.refId)?.name || blockById(state, relationship?.refId)?.name || occurrence.snapshot?.actionName || "Scheduled item";
}
function occurrenceRow(state, occurrence, controls = true) {
  const relationship = (state.blocks || []).flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId); const canSkip = relationship?.config?.allowSkip === true;
  return `<div class="samt-list-row"><div><strong>${esc(occurrenceName(state, occurrence))}</strong><small>${statusLabel(occurrence.status)} · ${esc(fmtDateTime(occurrence.scheduledAt || occurrence.availableFrom))}</small></div>${controls ? `<div class="samt-row-actions"><button class="samt-button small" data-action="complete-occurrence" data-id="${esc(occurrence.id)}">Complete</button>${canSkip ? `<button class="samt-button ghost small" data-action="skip-occurrence" data-id="${esc(occurrence.id)}">Skip</button>` : ""}</div>` : ""}</div>`;
}
function targetRow(target) {
  const progress = target.progress || {}; return `<div class="samt-list-row"><div><strong>${esc(target.name)}</strong><small>${esc(target.period)} · ${statusLabel(progress.status)}</small></div><div class="samt-metric"><b>${esc(String(progress.actual ?? 0))}</b><span>/ ${esc(String(progress.targetValue ?? 0))}</span><small>${pct(progress.percentage)}</small></div></div>`;
}

export function renderHomeView({ model = {}, state = {} } = {}) {
  const choice = model.now?.choice || { type: "next", items: [] }; const choiceNames = (choice.items || []).map((item) => item.name || item.label || item.snapshot?.block?.name || item.type).filter(Boolean);
  const due = [...(model.due?.overdue || []), ...(model.due?.dueNow || [])]; const project = model.currentProject;
  return `<section class="samt-page" aria-labelledby="home-title">
    <header class="samt-page-head"><div><p class="samt-eyebrow">SAMT · Direction and progress</p><h1 id="home-title">Home</h1><p class="samt-muted">${esc(fmtDateTime(model.now?.at || model.now || new Date()))}</p></div><button class="samt-button primary" data-action="open-log">＋ Log action</button></header>
    <div class="samt-home-grid">
      <article class="samt-card hero-card"><div class="samt-card-head"><div><span class="samt-eyebrow">Now</span><h2>${choiceNames.length ? esc(choiceNames[0]) : "Nothing requires attention"}</h2></div><span class="samt-badge">${esc(statusLabel(choice.type))}</span></div><p class="samt-muted">${choiceNames.length > 1 ? `Also available: ${esc(choiceNames.slice(1, 4).join(" · "))}` : "The engine will keep your position and wait for the next eligible item."}</p><div class="samt-card-actions"><button class="samt-button" data-action="open-log">Log progress</button><a class="samt-button ghost" href="#/blocks">Browse Blocks</a></div></article>
      <article class="samt-card"><div class="samt-card-head"><h2>Due</h2><span class="samt-count">${due.length}</span></div><div class="samt-list">${due.length ? due.slice(0, 6).map((item) => occurrenceRow(state, item)).join("") : `<p class="samt-empty">No positive work is due.</p>`}</div></article>
    </div>
    <div class="samt-section-grid">
      <article class="samt-card"><div class="samt-card-head"><h2>Avoid</h2><a href="#/actions?direction=avoid">View actions</a></div><div class="samt-list">${(model.avoid || []).length ? model.avoid.map((item) => `<div class="samt-list-row"><div><strong>${esc(item.name)}</strong><small>${esc(statusLabel(item.status || "on_track"))}</small></div><div class="samt-metric"><b>${esc(fmtMinutes(item.actual || 0))}</b></div></div>`).join("") : `<p class="samt-empty">No Avoid Actions configured.</p>`}</div></article>
      <article class="samt-card"><div class="samt-card-head"><h2>Today</h2><a href="#/analysis">Analyse</a></div><div class="samt-list">${(model.today || []).length ? model.today.map(targetRow).join("") : `<p class="samt-empty">No daily Targets are active.</p>`}</div></article>
      <article class="samt-card"><div class="samt-card-head"><h2>This week</h2><a href="#/analysis">Analyse</a></div><div class="samt-list">${(model.thisWeek || []).length ? model.thisWeek.map(targetRow).join("") : `<p class="samt-empty">No weekly Targets are active.</p>`}</div></article>
      <article class="samt-card"><div class="samt-card-head"><h2>Current project</h2><a href="#/projects">All projects</a></div>${project ? `<a class="samt-project-callout" href="#/blocks/${encodeURIComponent(project.id)}"><strong>${esc(project.name)}</strong><span>${esc(typeLabel(project.type))} · ${esc(statusLabel(project.definitionStatus))}</span></a>` : `<p class="samt-empty">Choose a primary Project in Settings.</p>`}</article>
    </div>
    <article class="samt-card"><div class="samt-card-head"><h2>Upcoming</h2><a href="#/todo">Open To-do</a></div><div class="samt-list">${(model.upcoming || []).length ? model.upcoming.map((item) => occurrenceRow(state, item, false)).join("") : `<p class="samt-empty">Nothing upcoming.</p>`}</div></article>
  </section>`;
}
