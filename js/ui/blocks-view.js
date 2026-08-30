import { BLOCK_LABELS, actionById, blockById, esc, fmtDate, fmtDateTime, pct, statusLabel, titleCase, typeLabel } from "./helpers.js";

const TERMINAL_RUNS = ["COMPLETED", "PARTIAL", "MISSED", "EXPIRED", "CANCELLED"];
const TERMINAL_CHILDREN = ["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "CANCELLED"];
const OPEN_OCCURRENCES = ["open", "available", "overdue", "in_progress"];

function button(action, label, attrs = "", kind = "") {
  return "<button class=\"samt-button " + (kind || "ghost") + " small\" type=\"button\" data-action=\"" + esc(action) + "\"" + attrs + ">" + esc(label) + "</button>";
}
function link(href, label, kind = "ghost") {
  return "<a class=\"samt-button " + kind + " small\" href=\"" + esc(href) + "\">" + esc(label) + "</a>";
}
function relationshipName(state, relationship) {
  return relationship?.label || (relationship?.kind === "action" ? actionById(state, relationship.refId)?.name : blockById(state, relationship?.refId)?.name) || "Missing reference";
}
function relationshipById(block, id) { return (block?.relationships || []).find((relationship) => relationship.id === id) || null; }
function unitSuffix(state, value) {
  if (!value || typeof value !== "object") return "";
  const unit = (state.units || []).find((item) => item.id === value.unitId);
  return unit ? " " + unit.symbol : value.unitId ? " " + value.unitId : "";
}
function displayValue(state, value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value")) return String(value.value) + unitSuffix(state, value);
  return String(value ?? "—");
}
function blockCard(block) {
  const relationships = block.relationships || [];
  return "<article class=\"samt-card samt-entity-card\"><div class=\"samt-card-head\"><div><a class=\"samt-entity-link\" href=\"#/blocks/" + encodeURIComponent(block.id) + "\"><h2>" + esc(block.name) + "</h2></a><span class=\"samt-badge\">" + esc(typeLabel(block.type)) + "</span></div><span class=\"samt-status\">" + esc(statusLabel(block.definitionStatus)) + "</span></div><p class=\"samt-muted\">" + esc(block.description || "No description") + "</p><div class=\"samt-stat-line\"><span>" + relationships.length + " relationship" + (relationships.length === 1 ? "" : "s") + "</span><span>" + esc(block.config?.period || block.config?.generationMode || "Reusable definition") + "</span></div><div class=\"samt-card-actions\">" + link("#/blocks/" + encodeURIComponent(block.id), "Open", "") + link("#/blocks/" + encodeURIComponent(block.id) + "/edit", "Edit") + (block.definitionStatus === "ACTIVE" ? button("pause-block", "Pause", " data-id=\"" + esc(block.id) + "\"") : block.definitionStatus === "PAUSED" ? button("activate-block", "Activate", " data-id=\"" + esc(block.id) + "\"") : "") + "</div></article>";
}

export function renderBlocksView({ state = {}, filterType = "all" } = {}) {
  const blocks = (state.blocks || []).filter((block) => filterType === "all" || block.type === filterType);
  return "<section class=\"samt-page\" aria-labelledby=\"blocks-title\"><header class=\"samt-page-head\"><div><p class=\"samt-eyebrow\">Definitions · relationships · runtime</p><h1 id=\"blocks-title\">Blocks</h1><p class=\"samt-muted\">Open uses a definition. Edit changes the reusable definition.</p></div><button class=\"samt-button primary\" type=\"button\" data-action=\"new-block\">＋ New Block</button></header><div class=\"samt-chip-row\">" + [["all", "All"], ...Object.entries(BLOCK_LABELS)].map(([value, label]) => "<a class=\"samt-chip " + (filterType === value ? "selected" : "") + "\" href=\"#/blocks?type=" + encodeURIComponent(value) + "\">" + esc(label) + "</a>").join("") + "</div><div class=\"samt-card-grid\">" + (blocks.length ? blocks.map(blockCard).join("") : "<article class=\"samt-card\"><p class=\"samt-empty\">No " + (filterType === "all" ? "Blocks" : esc(typeLabel(filterType)) + " Blocks") + " yet.</p></article>") + "</div></section>";
}

function childRow(state, block, relationship) {
  const target = relationship.kind === "action" ? actionById(state, relationship.refId) : blockById(state, relationship.refId);
  const href = relationship.kind === "action" ? "#/actions/" + encodeURIComponent(relationship.refId) : "#/blocks/" + encodeURIComponent(relationship.refId);
  const attrs = " data-block-id=\"" + esc(block.id) + "\" data-id=\"" + esc(relationship.id) + "\"";
  const edit = button("edit-relationship", "Edit", attrs);
  const log = relationship.kind === "action" && target ? button("open-log", "＋ Log", " data-id=\"" + esc(target.id) + "\" data-block-id=\"" + esc(block.id) + "\" data-relationship-id=\"" + esc(relationship.id) + "\"") : "";
  const schedule = relationship.config?.schedule?.mode ? " · " + titleCase(relationship.config.schedule.mode) : "";
  const permissions = [relationship.config?.required ? "Required" : "Optional", relationship.config?.allowSkip ? "Skip allowed" : ""].filter(Boolean).join(" · ");
  return "<div class=\"samt-list-row\"><div><a href=\"" + esc(href) + "\"><strong>" + esc(relationship.label || target?.name || "Missing reference") + "</strong></a><small>" + esc(relationship.kind) + " · position " + (Number(relationship.position || 0) + 1) + (permissions ? " · " + esc(permissions) : "") + esc(schedule) + "</small></div><div class=\"samt-row-actions\">" + log + edit + button("remove-relationship", "Remove", attrs) + "</div></div>";
}

function runControls(run) {
  const attrs = " data-id=\"" + esc(run.id) + "\"";
  if (["IN_PROGRESS", "READY_TO_FINISH", "OVERDUE"].includes(run.status)) return button("finish-run", run.status === "READY_TO_FINISH" ? "Finish" : "Finish", attrs, run.status === "READY_TO_FINISH" ? "primary" : "") + button("pause-run", "Pause", attrs) + button("cancel-run", "Cancel", attrs);
  if (run.status === "PAUSED") return button("resume-run", "Resume", attrs, "primary") + button("cancel-run", "Cancel", attrs);
  return "";
}
function runHeading(run) {
  return "<div class=\"samt-card-head\"><div><h3>" + esc(run.label || "Untitled Run") + "</h3><small>" + esc(statusLabel(run.status)) + " · started " + esc(fmtDateTime(run.startedAt || run.createdAt)) + "</small></div><div class=\"samt-row-actions\">" + runControls(run) + "</div></div>";
}
function runtimeChildButtons(block, run, child, relation) {
  const attrs = " data-run-id=\"" + esc(run.id) + "\" data-relationship-id=\"" + esc(child.relationshipId || child.id) + "\" data-block-id=\"" + esc(block.id) + "\"";
  const action = relation?.kind === "action" ? actionById({ actions: [relation.refId ? { id: relation.refId } : null].filter(Boolean) }, relation.refId) : null;
  const targetAction = relation?.kind === "action" ? relation.refId : null;
  let output = "";
  if (targetAction) output += button("log-run-action", "＋ Log", " data-id=\"" + esc(targetAction) + "\"" + attrs);
  if (child.state === "BLOCKED") output += button("unblock-" + block.type + "-child", "Unblock", attrs);
  if (!TERMINAL_CHILDREN.includes(child.state) && child.allowSkip === true) output += button("skip-" + block.type + "-child", "Skip", attrs);
  if (!TERMINAL_CHILDREN.includes(child.state) && child.allowExcuse === true) output += button("excuse-" + block.type + "-child", "Excuse", attrs);
  if (!TERMINAL_CHILDREN.includes(child.state) && child.allowNotApplicable === true) output += button("na-" + block.type + "-child", "N/A", attrs);
  return output;
}
function runtimeChildRow(state, block, run, child) {
  const relation = relationshipById(run.snapshot?.block || block, child.relationshipId || child.id);
  const target = relation?.kind === "action" ? actionById(state, relation.refId) : blockById(state, relation?.refId);
  const label = child.label || relation?.label || target?.name || "Child";
  const stateText = child.state + (child.required ? " · Required" : " · Optional") + (child.available === false ? " · Not available yet" : "");
  const attrs = " data-run-id=\"" + esc(run.id) + "\" data-relationship-id=\"" + esc(child.relationshipId || child.id) + "\" data-block-id=\"" + esc(block.id) + "\"";
  return "<div class=\"samt-list-row\"><div><strong>" + esc(label) + "</strong><small>" + esc(stateText) + (child.deadline ? " · deadline " + esc(fmtDateTime(child.deadline)) : "") + (child.reason ? " · " + esc(child.reason) : "") + "</small></div><div class=\"samt-row-actions\">" + runtimeChildButtons(block, run, child, relation) + (relation?.kind === "block" ? link("#/blocks/" + encodeURIComponent(relation.refId), "Open") : "") + "</div></div>";
}
function routineRun(state, block, run) {
  const progress = run.runtime?.evaluation?.progress || run.runtime?.progress || {};
  const children = run.children || run.runtime?.children || [];
  return "<article class=\"samt-card samt-runtime-card\">" + runHeading(run) + "<div class=\"samt-progress\"><span style=\"width:" + Math.min(100, Number(progress.percentage) || 0) + "%\"></span></div><p class=\"samt-muted\">" + esc(String(progress.completed || 0)) + "/" + esc(String(progress.total || children.length)) + " complete · " + esc(pct(progress.percentage || 0)) + " · required " + (progress.requiredSatisfied ? "satisfied" : "not satisfied") + (run.status === "READY_TO_FINISH" ? " · READY TO FINISH" : "") + "</p><div class=\"samt-list\">" + (children.length ? children.slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0)).map((child) => runtimeChildRow(state, block, run, child)).join("") : "<p class=\"samt-empty\">No child runtime state.</p>") + "</div></article>";
}
function workflowStepButtons(block, run, step) {
  const attrs = " data-run-id=\"" + esc(run.id) + "\" data-step-id=\"" + esc(step.id) + "\" data-block-id=\"" + esc(block.id) + "\"";
  let output = "";
  if (step.state === "LOCKED" && (step.availabilityMode || step.timing?.availabilityMode) === "manual") output += button("release-workflow-step", "Release", attrs, "primary");
  if (step.state === "AVAILABLE" || step.state === "OVERDUE") output += button("start-workflow-step", "Start", attrs, "primary");
  if (["AVAILABLE", "IN_PROGRESS", "OVERDUE"].includes(step.state)) output += button("complete-workflow-step", "Complete", attrs);
  if (!TERMINAL_CHILDREN.includes(step.state) && step.allowSkip === true) output += button("skip-workflow-step", "Skip", attrs);
  if (!TERMINAL_CHILDREN.includes(step.state) && step.allowExcuse === true) output += button("excuse-workflow-step", "Excuse", attrs);
  if (!TERMINAL_CHILDREN.includes(step.state) && step.allowNotApplicable === true) output += button("na-workflow-step", "N/A", attrs);
  if (step.state === "BLOCKED") output += button("unblock-workflow-step", "Unblock", attrs);
  if (!["COMPLETED", "CANCELLED"].includes(step.state)) output += button("block-workflow-step", "Block", attrs);
  if (["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE"].includes(step.state)) output += button("return-workflow-step", "Return", attrs);
  return output;
}
function workflowRun(state, block, run) {
  const steps = run.steps || run.runtime?.steps || [];
  const current = steps.find((step) => step.id === run.currentStepId) || steps.find((step) => ["AVAILABLE", "IN_PROGRESS", "BLOCKED", "OVERDUE"].includes(step.state));
  return "<article class=\"samt-card samt-runtime-card\">" + runHeading(run) + "<p class=\"samt-muted\">Current step: <strong>" + esc(current?.name || "None") + "</strong>" + (run.deadline ? " · workflow deadline " + esc(fmtDateTime(run.deadline)) : "") + "</p><div class=\"samt-list\">" + (steps.length ? steps.map((step) => "<div class=\"samt-list-row\"><div><strong>" + (step.id === current?.id ? "▶ " : "") + esc(step.name) + "</strong><small>" + esc(statusLabel(step.state)) + (step.required ? " · Required" : " · Optional") + (step.deadline ? " · deadline " + esc(fmtDateTime(step.deadline)) : "") + (step.expectedUnblockAt ? " · unblock by " + esc(fmtDateTime(step.expectedUnblockAt)) : "") + (step.reason ? " · " + esc(step.reason) : "") + "</small></div><div class=\"samt-row-actions\">" + workflowStepButtons(block, run, step) + "</div></div>").join("") : "<p class=\"samt-empty\">No workflow steps.</p>") + "</div></article>";
}
function projectConditionRows(run) {
  const results = run.runtime?.evaluation?.results || run.runtime?.evaluation?.conditionResults || [];
  if (!Array.isArray(results) || !results.length) return "<p class=\"samt-muted\">Conditions will appear as the Run is evaluated.</p>";
  return "<div class=\"samt-list\">" + results.map((item) => "<div class=\"samt-list-row\"><div><strong>" + esc(titleCase(item.condition?.type || "condition")) + "</strong><small>" + (item.satisfied ? "Satisfied" : "Not satisfied") + "</small></div><span class=\"samt-badge\">" + (item.satisfied ? "TRUE" : "FALSE") + "</span></div>").join("") + "</div>";
}
function projectMilestones(run) {
  const milestones = run.runtime?.milestones || [];
  return "<article class=\"samt-card\"><div class=\"samt-card-head\"><h3>Milestones</h3><button class=\"samt-button ghost small\" type=\"button\" data-action=\"add-project-milestone\" data-run-id=\"" + esc(run.id) + "\">＋ Add</button></div>" + (milestones.length ? "<div class=\"samt-list\">" + milestones.map((milestone) => "<div class=\"samt-list-row\"><div><strong>" + esc(milestone.name) + "</strong><small>" + esc(statusLabel(milestone.status)) + (milestone.dueAt ? " · due " + esc(fmtDate(milestone.dueAt)) : "") + "</small></div><div class=\"samt-row-actions\">" + (milestone.status === "open" ? button("edit-project-milestone", "Edit", " data-run-id=\"" + esc(run.id) + "\" data-milestone-id=\"" + esc(milestone.id) + "\"") + button("complete-project-milestone", "Complete", " data-run-id=\"" + esc(run.id) + "\" data-milestone-id=\"" + esc(milestone.id) + "\"") + button("cancel-project-milestone", "Cancel", " data-run-id=\"" + esc(run.id) + "\" data-milestone-id=\"" + esc(milestone.id) + "\"") : "") + "</div></div>").join("") + "</div>" : "<p class=\"samt-empty\">No milestones yet.</p>") + "</article>";
}
function projectRun(state, block, run) {
  const progress = run.runtime?.evaluation?.progress || run.runtime?.progress || {};
  const children = run.children || run.runtime?.children || [];
  const active = ["IN_PROGRESS", "READY_TO_FINISH", "OVERDUE", "PAUSED"].includes(run.status);
  return "<article class=\"samt-card samt-runtime-card\">" + runHeading(run) + (active ? "<div class=\"samt-inline-note\"><span>Definition edits stay future-only until applied to this Run.</span>" + button("apply-project-scope", "Apply current scope", " data-run-id=\"" + esc(run.id) + "\"") + "</div>" : "") + "<p class=\"samt-muted\">Outcome: " + esc(statusLabel(run.status)) + (run.deadline ? " · deadline " + esc(fmtDateTime(run.deadline)) : "") + "</p><div class=\"samt-progress\"><span style=\"width:" + Math.min(100, Number(progress.percentage) || 0) + "%\"></span></div><p class=\"samt-muted\">" + esc(String(progress.completed || 0)) + "/" + esc(String(progress.total || children.length)) + " complete · required " + esc(String(progress.requiredCompleted || 0)) + "/" + esc(String(progress.requiredCount || 0)) + " · " + (run.status === "READY_TO_FINISH" ? "READY TO FINISH" : "conditions evaluated below") + "</p>" + projectConditionRows(run) + "<div class=\"samt-list\">" + (children.length ? children.map((child) => runtimeChildRow(state, block, run, child)).join("") : "<p class=\"samt-empty\">No project child state.</p>") + "</div>" + projectMilestones(run) + "</article>";
}
function cycleRuntime(state, block) {
  const all = (state.cycleBigCycles || []).filter((item) => item.cycleId === block.id);
  const big = all.find((item) => item.status === "open") || all[all.length - 1] || null;
  const small = big ? (state.cycleSmallCycles || []).find((item) => item.id === big.currentSmallCycleId) || big.smallCycles?.find((item) => item.id === big.currentSmallCycleId) : null;
  const slots = small?.slots || [];
  const rawIndex = Number(big?.currentSlot ?? -1);
  const hasSmallCycle = Boolean(small?.id && slots.length);
  const hasCurrent = hasSmallCycle && rawIndex >= -1 && rawIndex < slots.length;
  const displayIndex = rawIndex < 0 ? 0 : rawIndex;
  const current = hasCurrent ? slots[displayIndex] || null : null;
  const next = current && rawIndex >= 0 ? slots[rawIndex + 1] || null : null;
  const relationship = current ? relationshipById(block, current.relationshipId) : null;
  const nextRelationship = next ? relationshipById(block, next.relationshipId) : null;
  const slotAttrs = current ? " data-id=\"" + esc(block.id) + "\" data-relationship-id=\"" + esc(current.relationshipId) + "\" data-small-cycle-id=\"" + esc(small.id) + "\"" : "";
  const skipAllowed = relationship?.config?.allowSkip === true;
  const total = big?.participantRelationshipIds?.length || 0;
  const coverage = big ? ((big.appearanceCoverage || []).length + "/" + total + " appeared · " + (big.completionCoverage || []).length + "/" + total + " completed") : "No Big Cycle yet";
  const needsGeneration = !hasSmallCycle || rawIndex >= slots.length;
  const canAdvance = Boolean(current && next && rawIndex >= 0);
  return "<article class=\"samt-card samt-runtime-card\"><div class=\"samt-card-head\"><div><h3>Cycle runtime</h3><small>" + esc(titleCase(block.config?.generationMode || big?.generationMode || "simple_ordered")) + " · Small Cycle " + esc(String(small?.smallCycleNumber || 0)) + " · Big Cycle " + esc(String(all.indexOf(big) + 1 || 1)) + "</small></div><div class=\"samt-row-actions\">" + (needsGeneration ? button("generate-small-cycle", "Generate next Small Cycle", " data-id=\"" + esc(block.id) + "\"") : "") + "</div></div><div class=\"samt-detail-grid\"><div><span class=\"samt-eyebrow\">Current</span><h2>" + esc(relationship ? relationshipName(state, relationship) : needsGeneration ? "Generate next" : "No slot") + "</h2><p class=\"samt-muted\">" + (current ? "slot " + (displayIndex + 1) + " of " + slots.length : "No generated slot is available") + "</p></div><div><span class=\"samt-eyebrow\">Next</span><h2>" + esc(next ? relationshipName(state, nextRelationship) : needsGeneration ? "Generate next Small Cycle" : "End of Small Cycle") + "</h2><p class=\"samt-muted\">" + esc(coverage) + "</p></div></div><div class=\"samt-card-actions\">" + (current ? button("resolve-cycle-slot", "Complete / Log", slotAttrs + " data-outcome=\"completed\"", "primary") : "") + (current && skipAllowed ? button("resolve-cycle-slot", "Skip", slotAttrs + " data-outcome=\"skipped\" data-require-reason=\"true\"") : "") + (current ? button("resolve-cycle-slot", "Defer", slotAttrs + " data-outcome=\"deferred\"") + button("resolve-cycle-slot", "Unavailable", slotAttrs + " data-outcome=\"unavailable\"") : "") + (canAdvance ? button("advance-cycle", "Next", " data-id=\"" + esc(block.id) + "\"") : needsGeneration ? button("generate-small-cycle", "Generate next Small Cycle", " data-id=\"" + esc(block.id) + "\"") : "") + "</div></article>";
}
function actionListRuntime(state, block) {
  const ids = new Set((block.relationships || []).map((relationship) => relationship.id));
  const now = Date.now();
  const occurrences = (state.occurrences || []).filter((occurrence) => ids.has(occurrence.relationshipId));
  const open = occurrences.filter((occurrence) => !["completed", "skipped", "missed", "expired", "excused", "not_applicable"].includes(occurrence.status));
  const recent = occurrences.filter((occurrence) => !open.includes(occurrence)).slice().sort((a, b) => new Date(b.updatedAt || b.resolvedAt || b.scheduledAt) - new Date(a.updatedAt || a.resolvedAt || a.scheduledAt)).slice(0, 8);
  const groups = { "OVERDUE": [], "AVAILABLE / DUE NOW": [], "UPCOMING": [], "RECENT": recent };
  for (const occurrence of open) {
    const dueAt = occurrence.deadline || occurrence.scheduledAt || occurrence.availableFrom;
    if (occurrence.deadline && new Date(occurrence.deadline).getTime() < now) groups.OVERDUE.push(occurrence);
    else if (!occurrence.availableFrom || new Date(occurrence.availableFrom).getTime() <= now) groups["AVAILABLE / DUE NOW"].push(occurrence);
    else groups.UPCOMING.push(occurrence);
  }
  const section = (title, items) => "<section><div class=\"samt-card-head\"><h3>" + title + "</h3><span class=\"samt-count\">" + items.length + "</span></div><div class=\"samt-card-grid compact\">" + (items.length ? items.map((occurrence) => {
    const relationship = relationshipById(block, occurrence.relationshipId);
    const action = relationship?.kind === "action" ? actionById(state, relationship.refId) : null;
    const attrs = " data-id=\"" + esc(action?.id || "") + "\" data-occurrence-id=\"" + esc(occurrence.id) + "\" data-block-id=\"" + esc(block.id) + "\" data-relationship-id=\"" + esc(occurrence.relationshipId) + "\"";
    const canSkip = relationship?.config?.allowSkip === true;
    return "<article class=\"samt-card\"><div class=\"samt-card-head\"><div><h4>" + esc(relationshipName(state, relationship)) + "</h4><span class=\"samt-badge\">" + esc(statusLabel(occurrence.status)) + "</span></div><small>" + esc(fmtDateTime(occurrence.scheduledAt || occurrence.availableFrom)) + "</small></div><p class=\"samt-muted\">" + (occurrence.deadline ? "deadline " + esc(fmtDateTime(occurrence.deadline)) : "no deadline") + "</p><div class=\"samt-card-actions\">" + (action ? button("open-log", "＋ Log", attrs, "primary") : "") + (canSkip && OPEN_OCCURRENCES.includes(occurrence.status) ? button("skip-occurrence", "Skip", attrs) : "") + link("#/blocks/" + encodeURIComponent(block.id), "Open") + "</div></article>";
  }).join("") : "<p class=\"samt-empty\">No records.</p>") + "</div></section>";
  return "<article class=\"samt-card samt-runtime-card\"><div class=\"samt-card-head\"><div><h3>Action List occurrences</h3><p class=\"samt-muted\">Only Action List relationships generate independent occurrences.</p></div></div>" + section("OVERDUE", groups.OVERDUE) + section("AVAILABLE / DUE NOW", groups["AVAILABLE / DUE NOW"]) + section("UPCOMING", groups.UPCOMING) + section("RECENT", groups.RECENT) + "</article>";
}
function targetHistory(state, block) {
  const periods = (state.periods || []).filter((period) => period.ownerId === block.id && period.status === "closed");
  const evaluations = new Map((state.targetEvaluations || []).map((evaluation) => [evaluation.periodId, evaluation]));
  return periods.length ? "<div class=\"samt-list\">" + periods.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).map((period) => {
    const evaluation = evaluations.get(period.id); const value = evaluation?.evaluation?.actual ?? period.evaluation?.actual ?? "—"; const target = evaluation?.evaluation?.target ?? period.snapshot?.targetValue ?? block.config?.targetValue ?? "—";
    return "<div class=\"samt-list-row\"><div><strong>" + esc(fmtDate(period.start) + " – " + fmtDate(period.end)) + "</strong><small>target " + esc(displayValue(state, target)) + " · actual " + esc(displayValue(state, value)) + "</small></div><span class=\"samt-badge\">" + esc(statusLabel(evaluation?.evaluation?.status || (evaluation?.evaluation?.reached ? "REACHED" : "MISSED"))) + "</span></div>";
  }).join("") + "</div>" : "<p class=\"samt-empty\">No closed Target periods yet.</p>";
}
function targetRuntime(state, block) {
  const progress = state.__targetProgress?.[block.id] || {};
  return "<article class=\"samt-card samt-runtime-card\"><div class=\"samt-card-head\"><h3>Current period</h3><span class=\"samt-badge\">" + esc(statusLabel(progress.status || "not_started")) + "</span></div><p class=\"samt-target-large\">" + esc(displayValue(state, progress.actual ?? 0)) + " <small>/ " + esc(displayValue(state, progress.targetValue ?? block.config?.targetValue ?? 0)) + "</small></p><div class=\"samt-progress\"><span style=\"width:" + Math.min(100, Number(progress.percentage) || 0) + "%\"></span></div><p class=\"samt-muted\">" + esc(pct(progress.percentage || 0)) + " · " + esc(block.config?.periodStyle || "calendar") + " " + esc(block.config?.period || "period") + "</p><h3>Closed period history</h3>" + targetHistory(state, block) + "</article>";
}
function runtimeForBlock(state, block, runs) {
  if (block.type === "collection") return "<article class=\"samt-card\"><div class=\"samt-card-head\"><h2>Collection</h2><span class=\"samt-badge\">Browse only</span></div><p class=\"samt-muted\">Collections organize reusable definitions. They do not create Runs or fake completion.</p></article>";
  if (block.type === "action_list") return actionListRuntime(state, block);
  if (block.type === "routine") return "<article class=\"samt-card\"><div class=\"samt-card-head\"><h2>Routine Runs</h2><span class=\"samt-count\">" + runs.length + "</span></div>" + (runs.length ? runs.slice().reverse().map((run) => routineRun(state, block, run)).join("") : "<p class=\"samt-empty\">No Routine Run yet. Start a fresh session.</p>") + "</article>";
  if (block.type === "workflow") return "<article class=\"samt-card\"><div class=\"samt-card-head\"><h2>Workflow Runs</h2><span class=\"samt-count\">" + runs.length + "</span></div>" + (runs.length ? runs.slice().reverse().map((run) => workflowRun(state, block, run)).join("") : "<p class=\"samt-empty\">No Workflow Run yet. Start an ordered process.</p>") + "</article>";
  if (block.type === "project") return "<article class=\"samt-card\"><div class=\"samt-card-head\"><h2>Project Runs</h2><span class=\"samt-count\">" + runs.length + "</span></div>" + (runs.length ? runs.slice().reverse().map((run) => projectRun(state, block, run)).join("") : "<p class=\"samt-empty\">No Project Run yet. Start an outcome.</p>") + "</article>";
  if (block.type === "cycle") return cycleRuntime(state, block);
  if (block.type === "target") return targetRuntime(state, block);
  return "";
}

export function renderBlockDetailView({ state = {}, block = null } = {}) {
  if (!block) return "<section class=\"samt-page\"><div class=\"samt-empty-state\"><h1>Block not found</h1><a class=\"samt-button\" href=\"#/blocks\">Back to Blocks</a></div></section>";
  const runs = (state.runs || []).filter((run) => run.blockId === block.id);
  const children = (block.relationships || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const runCapable = ["routine", "workflow", "project", "cycle"].includes(block.type);
  return "<section class=\"samt-page\" aria-labelledby=\"block-detail-title\"><header class=\"samt-page-head\"><div><a class=\"samt-back\" href=\"#/blocks\">← Blocks</a><p class=\"samt-eyebrow\">" + esc(typeLabel(block.type)) + " · Open</p><h1 id=\"block-detail-title\">" + esc(block.name) + "</h1><p class=\"samt-muted\">" + esc(block.description || "No description") + "</p></div><div class=\"samt-card-actions\">" + (runCapable ? button("start-run", "Run now", " data-id=\"" + esc(block.id) + "\"", "primary") : "") + link("#/blocks/" + encodeURIComponent(block.id) + "/edit", "Edit definition") + "</div></header><div class=\"samt-detail-grid\"><article class=\"samt-card\"><div class=\"samt-card-head\"><h2>Definition</h2><span class=\"samt-status\">" + esc(statusLabel(block.definitionStatus)) + "</span></div><dl class=\"samt-definition-list\"><div><dt>Type</dt><dd>" + esc(typeLabel(block.type)) + "</dd></div><div><dt>Relationships</dt><dd>" + children.length + "</dd></div><div><dt>Runs</dt><dd>" + runs.length + "</dd></div><div><dt>Activation</dt><dd>" + esc(statusLabel((state.activations || []).find((activation) => activation.blockId === block.id)?.status || "manual")) + "</dd></div></dl></article>" + activationPanel(state, block) + (block.type === "target" ? targetSummary(state, block) : "") + "</div>" + runtimeForBlock(state, block, runs) + "<article class=\"samt-card\"><div class=\"samt-card-head\"><div><h2>Relationships</h2><p class=\"samt-muted\">Context lives here; definitions remain reusable and editable without changing relationship IDs.</p></div><button class=\"samt-button small\" type=\"button\" data-action=\"add-relationship\" data-id=\"" + esc(block.id) + "\">＋ Add</button></div><div class=\"samt-list\">" + (children.length ? children.map((relationship) => childRow(state, block, relationship)).join("") : "<p class=\"samt-empty\">No children yet.</p>") + "</div></article></section>";
}
function activationPanel(state, block) {
  if (!["action_list", "routine", "workflow", "project", "cycle"].includes(block.type)) return "";
  const activations = (state.activations || []).filter((activation) => activation.blockId === block.id);
  const rows = activations.map((activation) => {
    const attrs = " data-id=\"" + esc(activation.id) + "\"";
    const control = activation.status === "active" ? button("pause-activation", "Pause", attrs) : activation.status === "paused" ? button("resume-activation", "Resume", attrs, "primary") : "";
    return "<div class=\"samt-list-row\"><div><strong>" + esc(activation.label || titleCase(activation.mode)) + "</strong><small>" + esc(statusLabel(activation.status)) + " · " + esc(titleCase(activation.mode)) + (activation.recurrence?.mode ? " · " + esc(titleCase(activation.recurrence.mode)) : "") + (activation.endAt ? " · ends " + esc(fmtDateTime(activation.endAt)) : "") + "</small></div><div class=\"samt-row-actions\">" + control + "</div></div>";
  }).join("");
  return "<article class=\"samt-card\"><div class=\"samt-card-head\"><div><h3>Activation</h3><p class=\"samt-muted\">Activation controls when new runtime is created. Definition status does not schedule work.</p></div><button class=\"samt-button primary small\" type=\"button\" data-action=\"manage-activation\" data-id=\"" + esc(block.id) + "\">＋ Activate / Schedule</button></div>" + (rows ? "<div class=\"samt-list\">" + rows + "</div>" : "<p class=\"samt-empty\">No Activation configured.</p>") + "</article>";
}

function targetSummary(state, block) {
  const progress = state.__targetProgress?.[block.id] || {};
  return "<article class=\"samt-card\"><div class=\"samt-card-head\"><h2>Target</h2><span class=\"samt-badge\">" + esc(titleCase(block.config?.mode || "accumulation")) + "</span></div><p class=\"samt-target-large\">" + esc(displayValue(state, progress.actual ?? 0)) + " <small>/ " + esc(displayValue(state, progress.targetValue ?? block.config?.targetValue ?? 0)) + "</small></p><div class=\"samt-progress\"><span style=\"width:" + Math.min(100, Number(progress.percentage) || 0) + "%\"></span></div><p class=\"samt-muted\">" + esc(statusLabel(progress.status || "not_started")) + " · " + esc(pct(progress.percentage || 0)) + " · " + esc(block.config?.contributionScope || "direct") + "</p></article>";
}

function resultFieldOptions(state, selected = "") {
  return (state.actions || []).flatMap((action) => (action.resultFields || []).map((field) => "<option value=\"" + esc(field.id) + "\" " + (field.id === selected ? "selected" : "") + ">" + esc(action.name) + " · " + esc(field.label) + "</option>")).join("");
}
function targetOptions(state, selected = "", exclude = "") {
  return (state.blocks || []).filter((block) => block.type === "target" && block.id !== exclude && block.definitionStatus !== "ARCHIVED").map((block) => "<option value=\"" + esc(block.id) + "\" " + (block.id === selected ? "selected" : "") + ">" + esc(block.name) + "</option>").join("");
}
function unitOptions(state, selected = "") {
  return (state.units || []).filter((unit) => unit.status !== "archived").map((unit) => "<option value=\"" + esc(unit.id) + "\" " + (unit.id === selected ? "selected" : "") + ">" + esc(unit.name) + " (" + esc(unit.symbol) + ")</option>").join("");
}
function conditionOptions(config = {}, state = {}, block = {}) {
  const condition = config.conditions?.[0] || { type: "all_required" };
  const type = condition.type || "all_required";
  const resultFields = resultFieldOptions(state, condition.fieldId);
  return "<label>Completion condition<select class=\"samt-input\" name=\"config.conditionType\">" + [["all_required", "All required children"], ["count", "Completed count"], ["percentage", "Completed percentage"], ["target", "Target condition"], ["result", "Result condition"], ["milestone", "Milestone condition"], ["manual", "Manual"]].map(([value, label]) => "<option value=\"" + value + "\" " + (type === value ? "selected" : "") + ">" + label + "</option>").join("") + "</select></label><label>Condition value<input class=\"samt-input\" name=\"config.conditionValue\" value=\"" + esc(String(condition.value ?? "")) + "\" placeholder=\"Count, percentage or expected result\"></label><label>Target condition<select class=\"samt-input\" name=\"config.conditionTargetId\"><option value=\"\">Choose Target</option>" + targetOptions(state, condition.targetId, block.id) + "</select></label><label>Result field<select class=\"samt-input\" name=\"config.conditionFieldId\"><option value=\"\">Choose Result Field</option>" + resultFields + "</select></label><label>Result operator<select class=\"samt-input\" name=\"config.conditionOperator\">" + [">=", ">", "=", "<=", "<"].map((item) => "<option value=\"" + item + "\" " + (condition.operator === item ? "selected" : "") + ">" + item + "</option>").join("") + "</select></label><label>Expected Unit<select class=\"samt-input\" name=\"config.conditionUnitId\"><option value=\"\">Field default Unit</option>" + unitOptions(state, condition.unitId) + "</select></label><label>Milestone ID<input class=\"samt-input\" name=\"config.conditionMilestoneId\" value=\"" + esc(String(condition.milestoneId || "")) + "\" placeholder=\"A Run milestone ID\"></label>";
}
function configFields(block, state = {}) {
  const config = block?.config || {};
  if (block?.type === "target") return "<div class=\"samt-form-grid\"><label>Mode<select class=\"samt-input\" name=\"config.mode\"><option value=\"accumulation\" " + (config.mode === "accumulation" ? "selected" : "") + ">Accumulation</option><option value=\"outcome\" " + (config.mode === "outcome" ? "selected" : "") + ">Outcome</option></select></label><label>Metric<select class=\"samt-input\" name=\"config.metric\"><option value=\"time\" " + (config.metric === "time" ? "selected" : "") + ">Time</option><option value=\"quantity\" " + (config.metric === "quantity" ? "selected" : "") + ">Quantity</option><option value=\"completion_count\" " + (config.metric === "completion_count" ? "selected" : "") + ">Completion count</option></select></label><label>Target value<input class=\"samt-input\" name=\"config.targetValue\" type=\"text\" value=\"" + esc(String(config.targetValue ?? 0)) + "\"></label><label>Comparison<select class=\"samt-input\" name=\"config.comparison\">" + [">=", ">", "=", "<=", "<"].map((item) => "<option value=\"" + esc(item) + "\" " + (config.comparison === item ? "selected" : "") + ">" + esc(item) + "</option>").join("") + "</select></label><label>Period<select class=\"samt-input\" name=\"config.period\">" + ["session", "day", "week", "month", "custom", "all_time"].map((item) => "<option value=\"" + item + "\" " + (config.period === item ? "selected" : "") + ">" + titleCase(item) + "</option>").join("") + "</select></label><label>Period style<select class=\"samt-input\" name=\"config.periodStyle\"><option value=\"calendar\" " + (config.periodStyle !== "rolling" ? "selected" : "") + ">Calendar</option><option value=\"rolling\" " + (config.periodStyle === "rolling" ? "selected" : "") + ">Rolling</option></select></label><label>Rolling window (days)<input class=\"samt-input\" name=\"config.rollingWindowDays\" type=\"number\" min=\"1\" step=\"1\" value=\"" + (config.rollingWindowDays == null ? "" : esc(String(config.rollingWindowDays))) + "\"></label><label>Custom start<input class=\"samt-input\" name=\"config.customStart\" type=\"date\" value=\"" + esc(String(config.customStart || "").slice(0, 10)) + "\"></label><label>Custom end<input class=\"samt-input\" name=\"config.customEnd\" type=\"date\" value=\"" + esc(String(config.customEnd || "").slice(0, 10)) + "\"></label><label>Contribution<select class=\"samt-input\" name=\"config.contributionScope\"><option value=\"direct\" " + (config.contributionScope !== "inclusive" && config.contributionScope !== "inclusive_unique" ? "selected" : "") + ">Direct only</option><option value=\"inclusive_unique\" " + (config.contributionScope === "inclusive" || config.contributionScope === "inclusive_unique" ? "selected" : "") + ">Inclusive unique descendants</option></select></label><label>Source Actions<select class=\"samt-input\" name=\"sourceActionId\" multiple size=\"4\">" + (state.actions || []).filter((action) => action.status !== "archived").map((action) => "<option value=\"" + esc(action.id) + "\" " + ((config.sourceActionIds || []).includes(action.id) ? "selected" : "") + ">" + esc(action.name) + "</option>").join("") + "</select></label><label>Outcome Result Field<select class=\"samt-input\" name=\"config.sourceResultFieldId\"><option value=\"\">Choose for outcome Targets</option>" + resultFieldOptions(state, config.sourceResultFieldId) + "</select></label><label>Outcome aggregation<select class=\"samt-input\" name=\"config.aggregation\">" + ["latest", "highest", "lowest", "average"].map((item) => "<option value=\"" + item + "\" " + (config.aggregation === item ? "selected" : "") + ">" + titleCase(item) + "</option>").join("") + "</select></label><label>Unit (for measurement)<select class=\"samt-input\" name=\"config.unitId\"><option value=\"\">No fixed Unit</option>" + unitOptions(state, config.unitId) + "</select></label><label>Required child Targets<select class=\"samt-input\" name=\"config.requiredChildTargetId\" multiple size=\"3\">" + targetOptions(state, "", block.id).replace(/<option value=\"([^\"]+)\"/g, (match, id) => "<option value=\"" + id + "\" " + ((config.requiredChildTargetIds || []).includes(id) ? "selected" : "")) + "</select></label></div>";
  if (block?.type === "cycle") return "<div class=\"samt-form-grid\"><label>Generation<select class=\"samt-input\" name=\"config.generationMode\"><option value=\"simple_ordered\" " + (config.generationMode === "simple_ordered" ? "selected" : "") + ">Simple ordered</option><option value=\"exact_frequency\" " + (config.generationMode === "exact_frequency" ? "selected" : "") + ">Exact frequency</option><option value=\"weighted_limited\" " + (config.generationMode === "weighted_limited" ? "selected" : "") + ">Weighted limited</option></select></label><label>Eligibility<select class=\"samt-input\" name=\"config.eligibility\"><option value=\"strict_order\" " + (config.eligibility !== "next_eligible" ? "selected" : "") + ">Strict order</option><option value=\"next_eligible\" " + (config.eligibility === "next_eligible" ? "selected" : "") + ">Next eligible</option></select></label><label>Small Cycle slots<input class=\"samt-input\" name=\"config.smallCycleSize\" type=\"number\" min=\"1\" step=\"1\" value=\"" + esc(String(config.smallCycleSize ?? "")) + "\"></label><label>Missed item policy<select class=\"samt-input\" name=\"config.missedItemPolicy\"><option value=\"keep_position\" " + (config.missedItemPolicy !== "advance_to_next" ? "selected" : "") + ">Keep position</option><option value=\"advance_to_next\" " + (config.missedItemPolicy === "advance_to_next" ? "selected" : "") + ">Advance to next</option><option value=\"restart_small_cycle\" " + (config.missedItemPolicy === "restart_small_cycle" ? "selected" : "") + ">Restart Small Cycle</option><option value=\"restart_big_cycle\" " + (config.missedItemPolicy === "restart_big_cycle" ? "selected" : "") + ">Restart Big Cycle</option></select></label><label>Period end<select class=\"samt-input\" name=\"config.periodEnd\"><option value=\"never\" " + (config.periodEnd !== "auto" ? "selected" : "") + ">Never</option><option value=\"auto\" " + (config.periodEnd === "auto" ? "selected" : "") + ">Auto close</option></select></label><label>Position policy<select class=\"samt-input\" name=\"config.positionPolicy\"><option value=\"continue\" " + (config.positionPolicy !== "restart" ? "selected" : "") + ">Continue</option><option value=\"restart\" " + (config.positionPolicy === "restart" ? "selected" : "") + ">Restart from beginning</option></select></label></div>";
  if (block?.type === "routine") return "<div class=\"samt-form-grid\"><label>Completion mode<select class=\"samt-input\" name=\"config.completionMode\"><option value=\"required_only\" " + (config.completionMode === "required_only" ? "selected" : "") + ">Required only</option><option value=\"count\" " + (config.completionMode === "count" ? "selected" : "") + ">Count</option><option value=\"percentage\" " + (config.completionMode === "percentage" ? "selected" : "") + ">Percentage</option><option value=\"manual\" " + (config.completionMode === "manual" ? "selected" : "") + ">Manual</option></select></label><label>Minimum count<input class=\"samt-input\" name=\"config.minimumCount\" type=\"number\" min=\"0\" step=\"1\" value=\"" + esc(String(config.minimumCount ?? 0)) + "\"></label><label>Minimum percentage<input class=\"samt-input\" name=\"config.minimumPercentage\" type=\"number\" min=\"0\" max=\"100\" step=\"1\" value=\"" + esc(String(config.minimumPercentage ?? 100)) + "\"></label><label>Finish behaviour<select class=\"samt-input\" name=\"config.finishBehaviour\"><option value=\"auto\" " + (config.finishBehaviour !== "ready" ? "selected" : "") + ">Auto finish</option><option value=\"ready\" " + (config.finishBehaviour === "ready" ? "selected" : "") + ">Ready to finish</option></select></label></div>";
  if (block?.type === "workflow") return "<div class=\"samt-form-grid\"><label>Finish behaviour<select class=\"samt-input\" name=\"config.finishBehaviour\"><option value=\"auto\" " + (config.finishBehaviour !== "confirm" ? "selected" : "") + ">Auto finish</option><option value=\"confirm\" " + (config.finishBehaviour === "confirm" ? "selected" : "") + ">Require confirmation</option></select></label><label>Progression<select class=\"samt-input\" name=\"config.progression\"><option value=\"ordered\" " + (config.progression !== "stages" ? "selected" : "") + ">Ordered steps</option><option value=\"stages\" " + (config.progression === "stages" ? "selected" : "") + ">Stages (future-ready)</option></select></label><label>Workflow deadline<input class=\"samt-input\" name=\"config.deadline\" type=\"date\" value=\"" + esc(String(config.deadline || "")) + "\"></label></div>";
  if (block?.type === "project") return "<fieldset><legend>Project outcome conditions</legend><div class=\"samt-form-grid\"><label>Condition combination<select class=\"samt-input\" name=\"config.combination\"><option value=\"all\" " + (config.combination !== "any" ? "selected" : "") + ">All conditions</option><option value=\"any\" " + (config.combination === "any" ? "selected" : "") + ">Any condition</option></select></label><label>Finish behaviour<select class=\"samt-input\" name=\"config.finishBehaviour\"><option value=\"ready\" " + (config.finishBehaviour !== "auto" ? "selected" : "") + ">Ready to finish</option><option value=\"auto\" " + (config.finishBehaviour === "auto" ? "selected" : "") + ">Auto finish</option></select></label><label>Deadline<input class=\"samt-input\" name=\"config.deadline\" type=\"date\" value=\"" + esc(String(config.deadline || "")) + "\"></label><label>Deadline policy<select class=\"samt-input\" name=\"config.deadlinePolicy\"><option value=\"continue_overdue\" " + (config.deadlinePolicy !== "hard_expiry" ? "selected" : "") + ">Continue overdue</option><option value=\"hard_expiry\" " + (config.deadlinePolicy === "hard_expiry" ? "selected" : "") + ">Expire unfinished</option></select></label>" + conditionOptions(config, state, block) + "</div></fieldset>";
  if (block?.type === "action_list") return "<div class=\"samt-form-grid\"><label>Default unfinished policy<select class=\"samt-input\" name=\"config.occurrencePolicy\"><option value=\"expire\" " + (config.occurrencePolicy !== "carry_forward" && config.occurrencePolicy !== "stay_overdue" ? "selected" : "") + ">Expire</option><option value=\"carry_forward\" " + (config.occurrencePolicy === "carry_forward" ? "selected" : "") + ">Carry forward</option><option value=\"stay_overdue\" " + (config.occurrencePolicy === "stay_overdue" ? "selected" : "") + ">Stay overdue</option></select></label><label>List behaviour<select class=\"samt-input\" name=\"config.listMode\"><option value=\"open_ended\" " + (config.listMode !== "configured_occurrences" ? "selected" : "") + ">Open-ended pool</option><option value=\"configured_occurrences\" " + (config.listMode === "configured_occurrences" ? "selected" : "") + ">Configured occurrences</option></select></label></div>";
  return "<p class=\"samt-muted\">This type has no extra configuration. Add relationships to define its structure.</p>";
}

export function renderBlockEditView({ state = {}, block = null } = {}) {
  if (!block) return "<section class=\"samt-page\"><div class=\"samt-empty-state\"><h1>Block not found</h1></div></section>";
  return "<section class=\"samt-page\" aria-labelledby=\"block-edit-title\"><header class=\"samt-page-head\"><div><a class=\"samt-back\" href=\"#/blocks/" + encodeURIComponent(block.id) + "\">← " + esc(block.name) + "</a><h1 id=\"block-edit-title\">Edit " + esc(typeLabel(block.type)) + "</h1><p class=\"samt-muted\">Permanent definition. Active Runs keep their start snapshot.</p></div></header><form class=\"samt-card samt-form\" data-form=\"edit-block\" data-id=\"" + esc(block.id) + "\"><div class=\"samt-form-grid\"><label>Name<input class=\"samt-input\" name=\"name\" value=\"" + esc(block.name) + "\" required></label><label>Definition status<select class=\"samt-input\" name=\"definitionStatus\">" + ["LIBRARY", "ACTIVE", "PAUSED", "ARCHIVED"].map((status) => "<option value=\"" + status + "\" " + (block.definitionStatus === status ? "selected" : "") + ">" + statusLabel(status) + "</option>").join("") + "</select></label></div><label>Description<textarea class=\"samt-input\" name=\"description\" rows=\"3\">" + esc(block.description || "") + "</textarea><fieldset><legend>Type configuration</legend>" + configFields(block, state) + "</fieldset><div class=\"samt-form-actions\"><button class=\"samt-button primary\" type=\"submit\">Save definition</button><a class=\"samt-button ghost\" href=\"#/blocks/" + encodeURIComponent(block.id) + "\">Cancel</a></div></form></section>";
}