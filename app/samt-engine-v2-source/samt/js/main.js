import { SamtEngine } from "./application/engine.js";
import { StructuredLogger } from "./application/events.js";
import { SystemClock } from "./infrastructure/clock.js";
import { LegacyBrowserRepository } from "./infrastructure/repository.js";
import { parseRoute, navigate } from "./ui/router.js";
import { moreNavigationMarkup } from "./ui/navigation.js";
import { ModalManager } from "./ui/modal-manager.js";
import { renderShell } from "./ui/shell.js";
import { renderHomeView } from "./ui/home-view.js";
import { renderActionsView, renderActionDetailView } from "./ui/actions-view.js";
import { renderBlocksView } from "./ui/blocks-view.js";
import { renderActionListsView } from "./ui/action-lists-view.js";
import { renderBlockDetailView } from "./ui/block-detail-view.js";
import { renderBlockEditView } from "./ui/block-edit-view.js";
import { renderAnalysisView } from "./ui/analysis-view.js";
import { renderHistoryView } from "./ui/history-view.js";
import { renderSettingsView } from "./ui/settings-view.js";
import { escapeHtml } from "./ui/format.js";

const appRoot = document.getElementById("app");
const modal = new ModalManager(document.getElementById("modal-root"));
const logger = new StructuredLogger(new URLSearchParams(location.search).has("debug"));
const repository = new LegacyBrowserRepository({ logger });
const engine = new SamtEngine({ repository, clock: new SystemClock(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London", logger });

function applyMode() {
  const mode = engine.state?.settings?.appearanceMode || "system";
  document.documentElement.dataset.mode = mode;
}

function renderRoute() {
  const route = parseRoute();
  let content;
  try {
    if (route.name === "home") content = renderHomeView(engine.queries.getHomeViewModel());
    else if (route.name === "actions") content = renderActionsView(engine.queries.getActions());
    else if (route.name === "action-detail") {
      const action = engine.queries.getActionById(route.id);
      const logs = engine.queries.getState().actionLogs.filter((item) => item.actionId === route.id);
      content = renderActionDetailView(action, logs);
    } else if (route.name === "blocks") content = renderBlocksView(engine.queries.getBlocks());
    else if (route.name === "action-lists") content = renderActionListsView(engine.queries.getBlocks({ type: "action_list" }));
    else if (route.name === "block-detail") {
      const detail = engine.queries.getBlockDetail(route.id);
      const block = engine.queries.getBlockById(route.id);
      const progress = block.type === "target" ? (block.direction === "avoid" ? engine.queries.getAvoidStatus(route.id) : engine.queries.getTargetProgress(route.id)) : null;
      content = renderBlockDetailView(detail, progress);
    } else if (route.name === "block-edit") content = renderBlockEditView(engine.queries.getBlockDetail(route.id));
    else if (route.name === "analysis") content = renderAnalysisView(engine.queries.getAnalysisViewModel());
    else if (route.name === "history") content = renderHistoryView(engine.queries.getState().history);
    else if (route.name === "settings") content = renderSettingsView(engine.queries.getState());
    else content = '<main class="page-shell"><div class="empty"><h1>Page not found</h1><a class="btn" href="#/">Return Home</a></div></main>';
    appRoot.innerHTML = renderShell(route, content, { storageStatus: repository.getStatus() });
    document.querySelector("[data-edit-block-form]")?.addEventListener("submit", saveBlockForm);
  } catch (error) { showError(error); }
}

function showToast(message) {
  const element = document.createElement("div");
  element.className = "toast";
  element.setAttribute("role", "status");
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 2600);
}

async function showError(error) {
  logger.error("UI", error.message, { code: error.code, details: error.details });
  await modal.open({ title: "SAMT could not complete that", body: `<p>${escapeHtml(error.message || "Unknown error")}</p>${error.code ? `<p class="muted">${escapeHtml(error.code)}</p>` : ""}`, cancelLabel: "Close" });
}

function actionFields(action = null) {
  const completion = action?.completion || { method: "quantity", target: 1, minimumMinutes: 0 };
  return `<div class="form-grid"><label class="field field-full"><span class="label">Name</span><input class="input" name="name" maxlength="100" required value="${escapeHtml(action?.name || "")}"></label><label class="field"><span class="label">Direction</span><select class="select" name="direction"><option value="do" ${action?.direction !== "avoid" ? "selected" : ""}>Do</option><option value="avoid" ${action?.direction === "avoid" ? "selected" : ""}>Avoid</option></select></label><label class="field"><span class="label">Completion</span><select class="select" name="method"><option value="quantity" ${completion.method === "quantity" ? "selected" : ""}>Quantity</option><option value="time" ${completion.method === "time" ? "selected" : ""}>Time</option></select></label><label class="field"><span class="label">Quantity target</span><input class="input" type="number" min="1" step="1" name="target" value="${escapeHtml(completion.target ?? 1)}"></label><label class="field"><span class="label">Minimum minutes</span><input class="input" type="number" min="0" step="1" name="minimumMinutes" value="${escapeHtml(completion.minimumMinutes ?? 0)}"></label><label class="field field-full"><span class="label">Description</span><textarea class="textarea" name="description">${escapeHtml(action?.description || "")}</textarea></label></div>`;
}

async function editAction(id = null) {
  const existing = id ? engine.queries.getActionById(id) : null;
  const data = await modal.open({ title: existing ? `Edit ${existing.name}` : "Create Action", body: actionFields(existing), submitLabel: existing ? "Save" : "Create" });
  if (!data) return;
  const method = data.get("method");
  const value = { name: data.get("name"), description: data.get("description"), direction: data.get("direction"), completion: { method, target: Number(data.get("target") || 1), minimumMinutes: Number(data.get("minimumMinutes") || 0) }, result: existing?.result || { mode: "none", scoreMax: null, unitId: null, allowedUnitIds: [] }, tagIds: existing?.tagIds || [] };
  if (existing) await engine.updateAction(existing.id, value); else await engine.createAction(value);
  showToast(existing ? "Action updated." : "Action created.");
  renderRoute();
}

function blockFields(type = "routine") {
  const options = [["cycle", "Cycle"], ["routine", "Routine"], ["workflow", "Workflow"], ["project", "Project"], ["action_list", "Action List"], ["collection", "Collection"], ["target", "Target Block"]];
  return `<div class="form-grid"><label class="field field-full"><span class="label">Name</span><input class="input" name="name" maxlength="100" required></label><label class="field"><span class="label">Type</span><select class="select" name="type">${options.map(([value, label]) => `<option value="${value}" ${type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span class="label">Direction</span><select class="select" name="direction"><option value="do">Do</option><option value="avoid">Avoid</option></select></label><label class="field"><span class="label">Target value (Target Block)</span><input class="input" type="number" min="1" step="1" name="targetValue" value="60"></label><label class="field"><span class="label">Target metric</span><select class="select" name="targetMetric"><option value="time">Time (minutes)</option><option value="quantity">Quantity</option><option value="completion_count">Completion count</option></select></label><label class="field"><span class="label">Period</span><select class="select" name="period"><option value="session">Session</option><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="all_time">All time</option></select></label><label class="field field-full"><span class="label">Description</span><textarea class="textarea" name="description"></textarea></label></div>`;
}

async function createBlock(type = "routine") {
  const data = await modal.open({ title: type === "action_list" ? "Create Action List" : "Create Block", body: blockFields(type), submitLabel: "Create" });
  if (!data) return;
  const selectedType = data.get("type");
  const direction = data.get("direction");
  const typeConfig = selectedType === "target" ? { targetMetric: data.get("targetMetric"), targetValue: Number(data.get("targetValue")), targetUnit: data.get("targetMetric") === "time" ? "minutes" : null, period: { mode: data.get("period"), weekStart: 1 }, aggregation: "inclusive_unique", requireChildTargets: false, requiredChildBlockIds: [], ...(direction === "avoid" ? { avoidEvaluation: { mode: "binary_limit", metric: data.get("targetMetric") === "completion_count" ? "count" : data.get("targetMetric"), binaryLimit: Number(data.get("targetValue")), period: { mode: data.get("period"), weekStart: 1 } } } : {}) } : {};
  const value = { name: data.get("name"), description: data.get("description"), type: selectedType, direction, children: [], completion: { mode: ["action_list", "collection"].includes(selectedType) ? "open" : "manual", threshold: 0, requiredRelIds: [], afterThreshold: "allow_extra" }, typeConfig, projectTargets: [] };
  const created = await engine.createBlock(value);
  showToast("Block created.");
  navigate(`/blocks/${created.value.id}`);
}

function localDateTimeValue(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function logFields(action, log = null) {
  const isTime = action.completion?.method === "time";
  const amount = isTime ? (log?.durationPerformed ?? 30) : (log?.quantityPerformed ?? 1);
  return `<div class="form-grid"><label class="field"><span class="label">${isTime ? "Minutes" : "Quantity"}</span><input class="input" name="value" type="number" min="${isTime ? 0.01 : 1}" step="${isTime ? 0.01 : 1}" required value="${escapeHtml(amount)}"></label><label class="field"><span class="label">When it happened</span><input class="input" name="timestamp" type="datetime-local" required value="${escapeHtml(localDateTimeValue(log?.timestamp || engine.clock.now()))}"></label>${action.result?.mode !== "none" ? `<label class="field"><span class="label">Result</span><input class="input" name="result" type="number" step="any" value="${escapeHtml(log?.resultValue ?? "")}"></label>` : ""}<label class="field field-full"><span class="label">Note</span><textarea class="textarea" name="note">${escapeHtml(log?.note || "")}</textarea></label></div>`;
}

async function logAction(id, { occurrenceId = null } = {}) {
  const action = engine.queries.getActionById(id);
  if (!action) return;
  const isTime = action.completion?.method === "time";
  const data = await modal.open({ title: `Log ${action.name}`, body: logFields(action), submitLabel: "Save log" });
  if (!data) return;
  const value = Number(data.get("value"));
  await engine.logAction(id, { ...(isTime ? { durationPerformed: value } : { quantityPerformed: value }), timestamp: new Date(data.get("timestamp")).toISOString(), resultValue: data.get("result") === "" ? null : Number(data.get("result")), note: data.get("note"), ...(occurrenceId ? { occurrenceId } : {}) });
  showToast("One factual Action Log saved.");
  renderRoute();
}

async function editLog(id) {
  const log = engine.queries.getState().actionLogs.find((item) => item.id === id);
  if (!log) return;
  const action = engine.queries.getActionById(log.actionId);
  if (!action) throw new Error("The Action definition for this log is unavailable.");
  const isTime = action.completion?.method === "time";
  const data = await modal.open({ title: `Correct ${action.name} log`, body: `${logFields(action, log)}<p class="muted">The original factual snapshot remains in History as a correction record.</p>`, submitLabel: "Save correction" });
  if (!data) return;
  const value = Number(data.get("value"));
  await engine.updateActionLog(id, { ...(isTime ? { durationPerformed: value } : { quantityPerformed: value }), timestamp: new Date(data.get("timestamp")).toISOString(), resultValue: data.get("result") === "" ? null : Number(data.get("result")), note: data.get("note") });
  showToast("Action Log corrected.");
  renderRoute();
}

async function quickLog() {
  const actions = engine.queries.getHomeViewModel().quickLog;
  if (!actions.length) { await modal.open({ title: "Quick Log", body: '<p>Create an Action first.</p>', cancelLabel: "Close" }); return; }
  const data = await modal.open({ title: "Quick Log", body: `<label class="field"><span class="label">Action</span><select class="select" name="actionId">${actions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label>`, submitLabel: "Continue" });
  if (data) await logAction(data.get("actionId"));
}

async function deleteDefinition(kind, id) {
  const object = kind === "action" ? engine.queries.getActionById(id) : engine.queries.getBlockById(id);
  if (!object) return;
  const confirmed = await modal.confirm({ title: `Delete ${object.name}?`, message: "It will disappear immediately from the live system and remain in the Bin for 10 days. Historical facts are not erased.", confirmLabel: "Move to Bin", destructive: true });
  if (!confirmed) return;
  await engine.deleteDefinition(kind, id);
  showToast(`${object.name} moved to Bin.`);
  if (parseRoute().id === id) navigate(kind === "action" ? "/actions" : "/blocks"); else renderRoute();
}

async function addBlockChild(blockId) {
  const parent = engine.queries.getBlockById(blockId);
  const actions = engine.queries.getActions().filter((item) => item.status !== "archived");
  const blocks = engine.queries.getBlocks().filter((item) => item.id !== blockId && item.status !== "archived");
  const options = [
    ...actions.map((item) => ({ value: `action:${item.id}`, label: `Action — ${item.name}` })),
    ...blocks.map((item) => ({ value: `block:${item.id}`, label: `${item.type.replaceAll("_", " ")} — ${item.name}` }))
  ];
  if (!options.length) { await modal.open({ title: "Add Child", body: "<p>Create another Action or Block first.</p>", cancelLabel: "Close" }); return; }
  const data = await modal.open({ title: `Add child to ${parent.name}`, body: `<div class="form-grid"><label class="field field-full"><span class="label">Existing definition</span><select class="select" name="child">${options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")}</select></label>${parent.type === "cycle" ? '<label class="field"><span class="label">Frequency per round</span><input class="input" name="frequency" type="number" min="1" step="1" value="1"></label>' : ""}<label class="field"><span class="label"><input type="checkbox" name="required" value="yes"> Required child</span></label></div>`, submitLabel: "Add Child" });
  if (!data) return;
  const selected = String(data.get("child"));
  const separator = selected.indexOf(":");
  const kind = selected.slice(0, separator);
  const refId = selected.slice(separator + 1);
  await engine.addBlockChild(blockId, { kind, refId, frequency: Number(data.get("frequency") || 1), required: data.get("required") === "yes" });
  showToast("Child relationship added.");
  renderRoute();
}

async function saveBlockForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  await engine.updateBlock(form.dataset.id, { name: form.elements.name.value, description: form.elements.description.value, status: form.elements.status.value });
  showToast("Block updated without changing its ID.");
  navigate(`/blocks/${encodeURIComponent(form.dataset.id)}`);
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importPackage() {
  const data = await modal.open({ title: "Import SAMT Package", body: '<label class="field"><span class="label">Choose JSON file</span><input class="input" name="file" type="file" accept="application/json,.json"></label><label class="field"><span class="label">Or paste JSON</span><textarea class="textarea" name="json"></textarea></label>', submitLabel: "Validate", wide: true });
  if (!data) return;
  const file = data.get("file");
  const text = file && file.size ? await file.text() : data.get("json");
  const preview = engine.prepareImport(text);
  const conflicts = preview.plan.filter((item) => !["new", "same_id_same"].includes(item.conflictType)).length;
  const confirmed = await modal.confirm({ title: "Import validated", message: `${preview.package.packageType}: ${preview.package.rootObjectIds.length} roots, ${preview.plan.filter((item) => item.conflictType === "new").length} new objects, ${conflicts} conflicts using safe defaults. Commit atomically?`, confirmLabel: "Import" });
  if (!confirmed) return;
  await engine.commitImport(preview);
  applyMode(); renderRoute(); showToast("Import complete. Restore Point created.");
}

async function startBlock(id) {
  const block = engine.queries.getBlockById(id);
  const detail = engine.queries.getBlockDetail(id);
  const periodMode = block.direction === "avoid" ? block.typeConfig?.avoidEvaluation?.period?.mode : block.typeConfig?.period?.mode;
  if (block.type === "target" && periodMode === "session") {
    await engine.startPeriod(id);
    showToast("Target session started.");
  } else {
    let activation = detail.activeActivation;
    if (!activation) activation = (await engine.activateBlock(id, { status: "manual" })).value;
    await engine.startRun(id, activation.id);
    showToast("Run started.");
  }
  renderRoute();
}

document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  try {
    if (action === "new-action") await editAction();
    else if (action === "edit-action") await editAction(control.dataset.id);
    else if (action === "log-action") await logAction(control.dataset.id);
    else if (action === "log-occurrence") await logAction(control.dataset.id, { occurrenceId: control.dataset.occurrenceId });
    else if (action === "edit-log") await editLog(control.dataset.id);
    else if (action === "quick-log") await quickLog();
    else if (action === "new-block") await createBlock();
    else if (action === "new-action-list") await createBlock("action_list");
    else if (action === "delete-action") await deleteDefinition("action", control.dataset.id);
    else if (action === "delete-block") await deleteDefinition("block", control.dataset.id);
    else if (action === "delete-log") { if (await modal.confirm({ title: "Delete this Action Log?", message: "The factual event and its contribution will be removed. A correction remains in History.", confirmLabel: "Delete Log", destructive: true })) { await engine.deleteActionLog(control.dataset.id); renderRoute(); } }
    else if (action === "add-block-child") await addBlockChild(control.dataset.id);
    else if (action === "remove-block-child") { if (await modal.confirm({ title: "Remove this child?", message: "The reusable definition remains available. Open occurrences for this relationship will be skipped.", confirmLabel: "Remove", destructive: true })) { await engine.removeBlockChild(control.dataset.id, control.dataset.relationshipId); renderRoute(); } }
    else if (action === "start-block") await startBlock(control.dataset.id);
    else if (action === "pause-run") { await engine.pauseRun(control.dataset.id); showToast("Run paused."); renderRoute(); }
    else if (action === "resume-run") { await engine.resumeRun(control.dataset.id); showToast("Run resumed."); renderRoute(); }
    else if (action === "finish-run") { await engine.finishRun(control.dataset.id); showToast("Run finished."); renderRoute(); }
    else if (action === "advance-cycle") { await engine.advanceCycle(control.dataset.id); showToast("Cycle advanced."); renderRoute(); }
    else if (action === "skip-occurrence") { await engine.skipOccurrence(control.dataset.id); showToast("Occurrence skipped."); renderRoute(); }
    else if (action === "set-primary-project") { await engine.setPrimaryProject(control.dataset.id); showToast("Primary Project updated."); renderRoute(); }
    else if (action === "close-period") { await engine.closePeriod(control.dataset.id); showToast("Session saved."); renderRoute(); }
    else if (action === "open-more") await modal.open({ title: "Navigate", body: moreNavigationMarkup(parseRoute()), cancelLabel: "Close" });
    else if (action === "set-mode") { await engine.setAppearanceMode(control.dataset.mode); applyMode(); renderRoute(); }
    else if (action === "export-backup") downloadJson(`samt-full-backup-${new Date().toISOString().slice(0, 10)}.json`, engine.makePackage("backup"));
    else if (action === "import-backup") await importPackage();
    else if (action === "undo-import") { if (await modal.confirm({ title: "Undo latest import?", message: "Restore the exact pre-import state?", confirmLabel: "Undo Import", destructive: true })) { await engine.undoImport(control.dataset.id); applyMode(); renderRoute(); } }
    else if (action === "restore-definition") { await engine.restoreDefinition(control.dataset.id); showToast("Definition restored from the Bin."); renderRoute(); }
  } catch (error) { await showError(error); }
});

globalThis.addEventListener("hashchange", renderRoute);

async function boot() {
  try {
    await engine.initialize();
    applyMode();
    renderRoute();
    globalThis.samtEngine = engine;
  } catch (error) {
    appRoot.innerHTML = `<main class="page-shell"><section class="card danger-zone section"><h1>Your data was not changed</h1><p>${escapeHtml(error.message)}</p><p class="muted">Open the previous SAMT file and export a Full Backup if this browser address is isolated.</p></section></main>`;
    await showError(error);
  }
}

boot();
