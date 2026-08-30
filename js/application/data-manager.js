import { normalizedKey, clone } from "../shared/validation.js";

export const DEFINITION_TYPES = ["category", "tag", "unit", "action", "block"];
export const BLOCK_SUBTYPES = ["collection", "action_list", "routine", "workflow", "project", "cycle", "target"];

const TYPE_LABELS = {
  category: "Category", tag: "Tag", unit: "Unit", action: "Action", block: "Block",
  activation: "Activation", run: "Run", occurrence: "Occurrence", period: "Target Period",
  targetEvaluation: "Target Evaluation", cycleSmallCycle: "Small Cycle", cycleBigCycle: "Big Cycle",
  actionLog: "Action Log", review: "Review", task: "Task", quickTask: "Quick Task",
  history: "History record", restorePoint: "Restore Point", importHistory: "Import record", bin: "Bin item"
};

const DEFINITION_COLLECTIONS = {
  category: "categories", tag: "tags", unit: "units", action: "actions", block: "blocks"
};

const RUNTIME_COLLECTIONS = {
  activation: "activations", run: "runs", occurrence: "occurrences", period: "periods",
  targetEvaluation: "targetEvaluations", cycleSmallCycle: "cycleSmallCycles", cycleBigCycle: "cycleBigCycles",
  actionLog: "actionLogs", review: "reviews", task: "tasks", quickTask: "quickTasks",
  history: "history", importHistory: "importHistory"
};

const TERMINAL_STATUSES = new Set(["completed", "skipped", "missed", "expired", "excused", "not_applicable", "COMPLETED", "CANCELLED", "MISSED"]);

export function typeLabel(type) { return TYPE_LABELS[type] || String(type || "Record"); }

function asRows(value) { return Array.isArray(value) ? value : []; }
function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function firstDate(record, keys = []) {
  for (const key of keys) {
    const date = safeDate(record?.[key]);
    if (date) return date.toISOString();
  }
  return null;
}
function statusFor(type, row) {
  if (type === "block") return row?.definitionStatus || "unknown";
  if (type === "bin") return "deleted";
  if (type === "history") return row?.type || "recorded";
  if (type === "period") return row?.status || "unknown";
  if (["actionLog", "targetEvaluation", "cycleSmallCycle", "cycleBigCycle"].includes(type)) return row?.status || "recorded";
  if (type === "restorePoint") return "available";
  if (type === "importHistory") return row?.success === false ? "failed" : "success";
  return row?.status || "active";
}
function labelFor(type, row, names) {
  const actions = names.actionRows;
  const blocks = names.blockRows;
  const relationships = names.relationships;
  if (["category", "tag", "unit", "action", "block", "review", "task", "quickTask"].includes(type)) return row?.name || row?.title || row?.label || row?.id;
  if (type === "activation") return row?.label || blocks.get(row?.blockId)?.name || row?.blockId || row?.id;
  if (type === "run") return row?.label || row?.snapshot?.block?.name || blocks.get(row?.blockId)?.name || row?.blockId || row?.id;
  if (type === "occurrence") {
    const relationship = relationships.get(row?.relationshipId);
    return row?.snapshot?.actionSnapshot?.name || actions.get(row?.snapshot?.actionId)?.name || relationship?.label || relationship?.parent?.name || row?.relationshipId || row?.id;
  }
  if (type === "period") return row?.snapshot?.name || blocks.get(row?.ownerId)?.name || row?.ownerId || row?.id;
  if (type === "targetEvaluation") return row?.snapshot?.name || blocks.get(row?.ownerId)?.name || row?.ownerId || row?.id;
  if (type === "cycleSmallCycle") return row?.cycleId ? `${blocks.get(row.cycleId)?.name || row.cycleId} · Small Cycle` : row?.id;
  if (type === "cycleBigCycle") return row?.cycleId ? `${blocks.get(row.cycleId)?.name || row.cycleId} · Big Cycle` : row?.id;
  if (type === "actionLog") return row?.actionSnapshot?.name || actions.get(row?.actionId)?.name || row?.actionId || row?.id;
  if (type === "history") return row?.description || row?.type || row?.id;
  if (type === "restorePoint") return row?.reason || "Restore point";
  if (type === "importHistory") return row?.packageName || row?.packageId || row?.packageType || row?.id;
  if (type === "bin") return row?.nameSnapshot || row?.snapshot?.name || row?.id;
  return row?.name || row?.id;
}

function addReference(map, id, reference) {
  if (!id) return;
  const list = map.get(id) || [];
  const key = `${reference.kind || "reference"}:${reference.id || ""}:${reference.label || ""}`;
  if (!list.some((item) => `${item.kind || "reference"}:${item.id || ""}:${item.label || ""}` === key)) list.push(reference);
  map.set(id, list);
}

function definitionSearchTerms(type, row, state, names) {
  const terms = [row?.name, row?.description, row?.id, row?.symbol, row?.dimension];
  if (type === "tag") terms.push(names.categories.get(row.categoryId));
  if (type === "action") {
    for (const tagId of row.tagIds || []) terms.push(names.tags.get(tagId), names.categories.get(names.tagCategories.get(tagId)));
    for (const field of row.resultFields || []) {
      terms.push(field.label, names.tags.get(field.resultTagId));
      for (const unitId of field.config?.allowedUnitIds || []) terms.push(names.units.get(unitId), names.unitSymbols.get(unitId));
      terms.push(names.units.get(field.config?.defaultUnitId), names.unitSymbols.get(field.config?.defaultUnitId));
    }
  }
  if (type === "block") {
    terms.push(typeLabel(row.type));
    for (const relationship of row.relationships || []) terms.push(relationship.label, names.actions.get(relationship.refId), names.blocks.get(relationship.refId));
  }
  return terms.filter(Boolean);
}

function recordCapabilities(type, row) {
  const definition = DEFINITION_TYPES.includes(type);
  const builtIn = type === "unit" && row?.builtIn;
  return {
    canArchive: definition && !builtIn,
    canMoveToBin: definition && !builtIn,
    canPermanentDelete: definition && !builtIn,
    selectable: (definition && !builtIn) || ["activation", "actionLog", "run", "occurrence", "period", "targetEvaluation", "cycleSmallCycle", "cycleBigCycle", "review", "task", "quickTask", "history", "importHistory"].includes(type)
  };
}

function missingDependencyCount(state, entry) {
  const snapshot = entry?.snapshot || {};
  const live = {
    category: new Set(asRows(state.categories).map((item) => item.id)),
    tag: new Set(asRows(state.tags).map((item) => item.id)),
    unit: new Set(asRows(state.units).map((item) => item.id)),
    action: new Set(asRows(state.actions).map((item) => item.id)),
    block: new Set(asRows(state.blocks).map((item) => item.id))
  };
  const missing = [];
  if (entry.objectType === "tag" && snapshot.categoryId && !live.category.has(snapshot.categoryId)) missing.push(snapshot.categoryId);
  if (entry.objectType === "action") {
    for (const id of snapshot.tagIds || []) if (!live.tag.has(id)) missing.push(id);
    for (const field of snapshot.resultFields || []) {
      if (field.resultTagId && !live.tag.has(field.resultTagId)) missing.push(field.resultTagId);
      for (const id of [field.config?.defaultUnitId, ...(field.config?.allowedUnitIds || [])].filter(Boolean)) if (!live.unit.has(id)) missing.push(id);
    }
  }
  if (entry.objectType === "unit" && snapshot.baseUnitId && !live.unit.has(snapshot.baseUnitId)) missing.push(snapshot.baseUnitId);
  if (entry.objectType === "block") {
    for (const relationship of snapshot.relationships || []) if (!(relationship.kind === "action" ? live.action : live.block).has(relationship.refId)) missing.push(relationship.refId);
    for (const id of [snapshot.config?.sourceBlockId, ...(snapshot.config?.descendantBlockIds || []), ...(snapshot.config?.requiredChildTargetIds || [])].filter(Boolean)) if (!live.block.has(id)) missing.push(id);
    for (const id of (snapshot.config?.sourceActionIds || []).filter(Boolean)) if (!live.action.has(id)) missing.push(id);
  }
  return [...new Set(missing)].length;
}

function makeRecord(type, row, state, references, historical, names, extra = {}) {
  const label = labelFor(type, row, names);
  const date = firstDate(row, type === "actionLog" ? ["eventAt", "createdAt"] : type === "history" ? ["timestamp"] : type === "bin" ? ["deletedAt"] : ["updatedAt", "createdAt", "date", "closedAt", "finishedAt", "startedAt"]);
  const searchTerms = [label, row?.description, row?.note, row?.id, row?.status, typeLabel(type), row?.contextLabel, row?.snapshot?.name, row?.actionSnapshot?.name];
  if (type === "actionLog") {
    searchTerms.push(row?.actionSnapshot?.id);
    for (const reference of row?.contextRefs || []) searchTerms.push(reference.label, names.blocks.get(reference.blockId), names.runs.get(reference.runId), names.occurrences.get(reference.occurrenceId));
    for (const value of row?.resultValues || []) searchTerms.push(value.snapshot?.fieldLabel, value.snapshot?.unitSymbol, value.snapshot?.unitId);
  }
  if (type === "occurrence") searchTerms.push(row?.snapshot?.actionId, row?.snapshot?.unfinishedPolicy);
  const capability = recordCapabilities(type, row);
  const activeReferences = references.get(row?.id) || [];
  const historicalReferences = historical.get(row?.id) || [];
  return {
    id: row?.id,
    stableId: row?.id,
    type,
    typeLabel: typeLabel(type),
    subtype: type === "block" ? row?.type || null : null,
    label: String(label || row?.id || "Untitled"),
    description: String(row?.description || row?.note || ""),
    status: String(statusFor(type, row)),
    date,
    searchText: searchTerms.concat(extra.searchTerms || []).filter(Boolean).map((value) => normalizedKey(value)).join(" "),
    activeReferences: clone(activeReferences) || [],
    historicalReferences: clone(historicalReferences) || [],
    activeReferenceCount: activeReferences.length,
    historicalReferenceCount: historicalReferences.length,
    hasActiveReferences: activeReferences.length > 0,
    hasHistory: historicalReferences.length > 0,
    usage: activeReferences.length ? "used_somewhere" : historicalReferences.length ? "historical_only" : "unused",
    dependencyStatus: extra.dependencyStatus || "clear",
    source: row,
    ...capability,
    ...extra
  };
}

export function buildDataManagerIndex(state = {}) {
  const names = {
    actionRows: new Map(asRows(state.actions).map((item) => [item.id, item])),
    blockRows: new Map(asRows(state.blocks).map((item) => [item.id, item])),
    relationships: new Map(asRows(state.blocks).flatMap((block) => asRows(block.relationships).map((item) => [item.id, { ...item, parent: block }]))),
    categories: new Map(asRows(state.categories).map((item) => [item.id, item.name])),
    tags: new Map(asRows(state.tags).map((item) => [item.id, item.name])),
    tagCategories: new Map(asRows(state.tags).map((item) => [item.id, item.categoryId])),
    units: new Map(asRows(state.units).map((item) => [item.id, item.name])),
    unitSymbols: new Map(asRows(state.units).map((item) => [item.id, item.symbol])),
    actions: new Map(asRows(state.actions).map((item) => [item.id, item.name])),
    blocks: new Map(asRows(state.blocks).map((item) => [item.id, item.name])),
    runs: new Map(asRows(state.runs).map((item) => [item.id, item.label || item.id])),
    occurrences: new Map(asRows(state.occurrences).map((item) => [item.id, item.id]))
  };
  const active = new Map(); const historical = new Map();
  const addActive = (id, kind, source, label) => addReference(active, id, { kind, id: source?.id || source, label: label || source?.name || source?.label || source?.id || source });
  const addHistorical = (id, kind, source, label) => addReference(historical, id, { kind, id: source?.id || source, label: label || source?.name || source?.label || source?.id || source });
  for (const tag of asRows(state.tags)) addActive(tag.categoryId, "tag", tag, tag.name);
  for (const action of asRows(state.actions)) {
    for (const tagId of action.tagIds || []) addActive(tagId, "action tag", action, action.name);
    for (const field of action.resultFields || []) {
      if (field.resultTagId) addActive(field.resultTagId, "result field tag", action, `${action.name} · ${field.label}`);
      for (const unitId of new Set([field.config?.defaultUnitId, ...(field.config?.allowedUnitIds || [])].filter(Boolean))) addActive(unitId, "result field unit", action, `${action.name} · ${field.label}`);
    }
  }
  for (const block of asRows(state.blocks)) {
    for (const relationship of block.relationships || []) addActive(relationship.refId, `${relationship.kind} relationship`, block, `${block.name}${relationship.label ? ` · ${relationship.label}` : ""}`);
    for (const actionId of block.config?.sourceActionIds || []) addActive(actionId, "target source", block, block.name);
    for (const blockId of [block.config?.sourceBlockId, ...(block.config?.descendantBlockIds || []), ...(block.config?.requiredChildTargetIds || [])].filter(Boolean)) addActive(blockId, "block configuration", block, block.name);
    if (block.config?.unitId) addActive(block.config.unitId, "block unit", block, block.name);
  }
  if (state.settings?.primaryProjectId) addActive(state.settings.primaryProjectId, "primary project", state.settings, "Primary Project");
  for (const activation of asRows(state.activations)) {
    const reference = activation.label || activation.id;
    if (["active", "paused"].includes(activation.status)) addActive(activation.blockId, "activation", activation, reference);
    else addHistorical(activation.blockId, "activation history", activation, reference);
  }
  for (const run of asRows(state.runs)) {
    const reference = run.label || run.id;
    if (!TERMINAL_STATUSES.has(run.status)) addActive(run.blockId, "run", run, reference);
    addHistorical(run.blockId, "run history", run, run.snapshot?.block?.name || run.blockId);
  }

  for (const log of asRows(state.actionLogs)) {
    addHistorical(log.actionId, "action log", log, log.actionSnapshot?.name || log.actionId);
    for (const reference of log.contextRefs || []) {
      if (reference.blockId) addHistorical(reference.blockId, "action log context", log, reference.blockSnapshot?.name || names.blocks.get(reference.blockId) || reference.blockId);
      if (reference.runId) addHistorical(reference.runId, "action log context", log, names.runs.get(reference.runId) || reference.runId);
      if (reference.occurrenceId) addHistorical(reference.occurrenceId, "action log context", log, reference.occurrenceId);
    }
    for (const value of log.resultValues || []) {
      if (value.snapshot?.resultTagId) addHistorical(value.snapshot.resultTagId, "result value tag", log, value.snapshot.fieldLabel || value.snapshot.resultTagId);
      if (value.snapshot?.unitId || value.value?.unitId) addHistorical(value.snapshot.unitId || value.value.unitId, "result value unit", log, value.snapshot.unitSymbol || value.snapshot.unitId || value.value.unitId);
    }
  }
  for (const occurrence of asRows(state.occurrences)) {
    const relationship = names.relationships.get(occurrence.relationshipId);
    if (relationship?.parent?.id) addHistorical(relationship.parent.id, "occurrence history", occurrence, relationship.parent.name);
    if (relationship?.kind === "action") addHistorical(relationship.refId, "occurrence history", occurrence, names.actions.get(relationship.refId) || relationship.refId);
    if (occurrence.snapshot?.actionSnapshot?.id) addHistorical(occurrence.snapshot.actionSnapshot.id, "occurrence snapshot", occurrence, occurrence.snapshot.actionSnapshot.name);
    if (occurrence.snapshot?.blockSnapshot?.id) addHistorical(occurrence.snapshot.blockSnapshot.id, "occurrence snapshot", occurrence, occurrence.snapshot.blockSnapshot.name);
  }
  for (const period of asRows(state.periods)) {
    if (period.status === "open") addActive(period.ownerId, "open period", period, period.snapshot?.name || period.ownerId);
    addHistorical(period.ownerId, "period history", period, period.snapshot?.name || period.ownerId);
  }
  for (const evaluation of asRows(state.targetEvaluations)) addHistorical(evaluation.ownerId, "target evaluation", evaluation, evaluation.snapshot?.name || evaluation.ownerId);
  for (const unit of asRows(state.units)) if (unit.baseUnitId) addActive(unit.baseUnitId, "unit base", unit, unit.name);
  for (const task of [...asRows(state.tasks), ...asRows(state.quickTasks)]) if (task.actionId) {
    const historical = TERMINAL_STATUSES.has(task.status) || ["completed", "cancelled", "archived"].includes(String(task.status || "").toLowerCase());
    (historical ? addHistorical : addActive)(task.actionId, historical ? "task history" : "task", task, task.name || task.id);
  }
  // Definition audit entries describe edits to the live library; they are not
  // runtime usage and must not make a never-used definition look historical.
  // Factual runtime/lifecycle entries still contribute to historical usage.
  for (const event of asRows(state.history)) if (!event.metadata?.management && event.type !== "definition") {
    for (const id of [event.objectId, event.actionId, event.blockId, event.ownerId].filter(Boolean)) addHistorical(id, "history record", event, event.description || event.type);
  }

  const records = [];
  for (const type of DEFINITION_TYPES) for (const row of asRows(state[DEFINITION_COLLECTIONS[type]])) records.push(makeRecord(type, row, state, active, historical, names, { searchTerms: definitionSearchTerms(type, row, state, names) }));
  for (const [type, collection] of Object.entries(RUNTIME_COLLECTIONS)) for (const row of asRows(state[collection])) records.push(makeRecord(type, row, state, active, historical, names));
  for (const [index, point] of asRows(state.meta?.restorePoints).entries()) records.push(makeRecord("restorePoint", { ...point, id: point.id || `restore_point_${index + 1}` }, state, active, historical, names, { selectable: false, canArchive: false, canMoveToBin: false, canPermanentDelete: false, source: point }));
  for (const row of asRows(state.bin)) {
    const missing = missingDependencyCount(state, row) || row?.dependencyMetadata?.missingCount || row?.dependencies?.missing?.length || 0;
    records.push(makeRecord("bin", row, state, active, historical, names, { subtype: row.objectType || null, dependencyStatus: missing ? "missing" : "clear", selectable: true, canArchive: false, canMoveToBin: false, canPermanentDelete: true, source: row }));
  }
  for (const tombstone of asRows(state.tombstones)) records.push(makeRecord("tombstone", tombstone, state, active, historical, names, { selectable: false, canArchive: false, canMoveToBin: false, canPermanentDelete: false, source: tombstone }));
  const availableTypes = [...new Set(records.map((record) => record.type))];
  const availableStatuses = [...new Set(records.map((record) => record.status).filter(Boolean))].sort();
  const availableSubtypes = [...new Set(records.map((record) => record.subtype).filter(Boolean))].sort();
  return { records, availableTypes, availableStatuses, availableSubtypes, generatedAt: new Date().toISOString() };
}

function dateMatches(record, filters, now) {
  // Date filters are meaningful for runtime, history, Bin and recovery records;
  // library definitions have no event date and therefore remain visible.
  if (DEFINITION_TYPES.includes(record.type)) return true;
  const date = safeDate(record.date);
  const mode = filters.dateFilter || filters.date || "all";
  if (mode === "all" || !mode) return true;
  if (!date) return false;
  const current = safeDate(now) || new Date();
  const start = new Date(current); start.setHours(0, 0, 0, 0);
  if (mode === "today") return date >= start;
  if (mode === "week") { const weekStartsOn = Number.isInteger(Number(filters.weekStartsOn)) ? Number(filters.weekStartsOn) : 1; const weekStart = new Date(start); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() - weekStartsOn + 7) % 7)); return date >= weekStart; }
  if (mode === "month") { const month = new Date(start.getFullYear(), start.getMonth(), 1); return date >= month; }
  if (mode === "year") { const year = new Date(start.getFullYear(), 0, 1); return date >= year; }
  if (mode === "before") return filters.before ? date < new Date(`${filters.before}T00:00:00.000Z`) : true;
  if (mode === "after") return filters.after ? date > new Date(`${filters.after}T23:59:59.999Z`) : true;
  if (mode === "custom") {
    const from = filters.from ? new Date(`${filters.from}T00:00:00.000Z`) : null;
    const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null;
    return (!from || date >= from) && (!to || date <= to);
  }
  return true;
}

export function filterDataManagerRecords(index, filters = {}, { now = new Date() } = {}) {
  const query = normalizedKey(filters.search || filters.query || "");
  const type = filters.type || "all";
  const subtype = filters.subtype || "all";
  const status = filters.status || "all";
  const usage = filters.usage || "all";
  const history = filters.history || "all";
  const dependency = filters.dependency || "all";
  const records = (index?.records || []).filter((record) => {
    if (type !== "all" && record.type !== type) return false;
    if (subtype !== "all" && record.subtype !== subtype) return false;
    if (status !== "all" && record.status !== status) return false;
    if (query && !record.searchText.includes(query)) return false;
    if ((usage === "unused" && (record.hasActiveReferences || record.hasHistory)) || (usage === "no_history" && record.hasHistory)) return false;
    if ((usage === "used_somewhere" && !record.hasActiveReferences && !record.hasHistory) || (usage === "active_references" && !record.hasActiveReferences) || (usage === "historical_only" && !record.hasHistory) || (usage === "historical_only" && record.hasActiveReferences)) return false;
    if (usage === "has_history" && !record.hasHistory) return false;
    if ((history === "no_history" && record.hasHistory) || (history === "has_history" && !record.hasHistory)) return false;
    if (dependency !== "all" && record.dependencyStatus !== dependency) return false;
    return dateMatches(record, filters, now);
  });
  return { ...index, records, total: records.length, filters: clone(filters) || {} };
}

export function getDefinitionImpact(state = {}, type, id) {
  const index = buildDataManagerIndex(state);
  const record = index.records.find((item) => item.type === type && item.id === id)
    || index.records.find((item) => item.type === "bin" && item.subtype === type && item.id === id);
  const collection = DEFINITION_COLLECTIONS[type];
  const source = collection ? asRows(state[collection]).find((item) => item.id === id) : null;
  const binSnapshot = asRows(state.bin).find((entry) => entry.id === id && entry.objectType === type)?.snapshot || null;
  const definition = source || binSnapshot;
  const activeReferences = record?.activeReferences || [];
  const historicalReferences = record?.historicalReferences || [];
  const liveChildReferences = type === "block" ? asRows(definition?.relationships).map((relationship) => ({ kind: relationship.kind, id: relationship.refId, label: relationship.label || relationship.refId })) : type === "category" ? asRows(state.tags).filter((tag) => tag.categoryId === id).map((tag) => ({ kind: "tag", id: tag.id, label: tag.name })) : [];
  const binnedChildReferences = type === "category" ? asRows(state.bin).filter((entry) => entry.objectType === "tag" && entry.snapshot?.categoryId === id).map((entry) => ({ kind: "bin tag", id: entry.objectId || entry.id, label: entry.nameSnapshot || entry.snapshot?.name || entry.id })) : [];
  const childReferences = [...liveChildReferences, ...binnedChildReferences];
  const blockedBy = type === "category" && liveChildReferences.length ? "dependent_tags" : null;
  return {
    type, id, label: record?.label || definition?.name || id,
    activeReferences, historicalReferences, childReferences,
    activeReferenceCount: activeReferences.length, historicalReferenceCount: historicalReferences.length,
    relationshipRemovals: activeReferences.filter((reference) => String(reference.kind).includes("relationship")).length,
    affectedRuns: asRows(state.runs).filter((run) => run.blockId === id || run.snapshot?.block?.id === id).map((run) => run.id),
    affectedTargets: asRows(state.blocks).filter((block) => block.type === "target" && ((block.config?.sourceActionIds || []).includes(id) || block.id === id)).map((block) => block.id),
    tombstoneRequired: historicalReferences.length > 0,
    blockedBy,
    safeToPurge: !activeReferences.length && !historicalReferences.length && !(type === "unit" && definition?.builtIn),
    notes: [
      type === "block" && childReferences.length ? "Children are referenced definitions and will not be cascade-deleted." : null,
      type === "category" && childReferences.length ? "Tags must be handled explicitly before this Category can leave live definitions." : null,
      historicalReferences.length ? "Historical snapshots/tombstones are retained; factual History is not deleted." : null
    ].filter(Boolean)
  };
}

export function buildClearDataImpact(state = {}, options = {}) {
  const index = filterDataManagerRecords(buildDataManagerIndex(state), { ...options, weekStartsOn: options.weekStartsOn ?? state.settings?.weekStartsOn }, { now: options.now || new Date() });
  const categories = new Set(options.categories || []);
  const count = (type) => index.records.filter((record) => record.type === type).length;
  const definitions = categories.has("definitions") ? DEFINITION_TYPES.reduce((sum, type) => sum + index.records.filter((record) => record.type === type && record.canMoveToBin).length, 0) : 0;
  const activations = categories.has("activations") ? count("activation") : 0;
  const actionLogs = categories.has("actionLogs") ? count("actionLog") : 0;
  const runs = categories.has("runs") ? count("run") : 0;
  const occurrences = categories.has("occurrences") ? count("occurrence") : 0;
  const periods = categories.has("targetPeriodHistory") ? index.records.filter((record) => record.type === "period" && record.status === "closed").length : 0;
  const cycleRuntime = categories.has("cycleRuntimeHistory") ? count("cycleSmallCycle") + count("cycleBigCycle") : 0;
  const reviews = categories.has("reviews") ? count("review") : 0;
  const tasks = categories.has("tasks") ? count("task") + count("quickTask") : 0;
  return {
    definitions, activations, actionLogs, runs, occurrences, periods, cycleRuntime, reviews, tasks,
    historyRecords: categories.has("history") ? count("history") : 0,
    settings: categories.has("settings") ? 1 : 0,
    historicalTombstonesRetained: definitions ? asRows(state.tombstones).length : 0,
    targetCalculationsAffected: actionLogs + periods,
    analysisAffected: actionLogs,
    occurrenceCompletionAffected: actionLogs + occurrences,
    filters: clone(options) || {}
  };
}

export function definitionCollection(type) { return DEFINITION_COLLECTIONS[type] || null; }
export function runtimeCollection(type) { return RUNTIME_COLLECTIONS[type] || null; }
export function isTerminalStatus(status) { return TERMINAL_STATUSES.has(status); }
