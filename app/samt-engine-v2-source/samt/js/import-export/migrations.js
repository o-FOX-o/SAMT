import { deepClone } from "../shared/validation.js";

export const INTERNAL_STORAGE_VERSION = 2;
export const PACKAGE_SCHEMA_VERSION = 2;
export const LEGACY_SCHEMA_VERSION = "1.11.0";
export const ENGINE_APP_VERSION = "2.0.0";

const ARRAY_KEYS = [
  "categories", "tags", "units", "actions", "blocks", "activationPresets", "activations", "runs", "occurrences",
  "actionLogs", "history", "analysisTargets", "targetPeriods", "avoidPeriods", "periodEvaluations", "styles",
  "restorePoints", "importHistory", "bin"
];

export function createEmptyState(now, timezone = "Europe/London") {
  const state = {
    schemaVersion: LEGACY_SCHEMA_VERSION,
    appVersion: ENGINE_APP_VERSION,
    internalStorageVersion: INTERNAL_STORAGE_VERSION,
    meta: { createdAt: now, updatedAt: now, seedPolicy: "empty", engineArchitecture: "modular-v2" },
    settings: {
      onboardingCompleted: true,
      timezone,
      appearanceMode: "system",
      primaryProjectId: null,
      behaviourDefaults: {
        targets: { autoClose: true },
        cycles: { autoClose: true, position: "continue", missedItem: "keep" },
        routines: { expireUnfinishedOccurrence: true },
        actionLists: { expireConfiguredOccurrences: true }
      },
      createdAt: now,
      updatedAt: now
    }
  };
  for (const key of ARRAY_KEYS) state[key] = [];
  return state;
}

export function validateLegacyShape(candidate) {
  if (!candidate || typeof candidate !== "object") return { ok: false, error: "Stored SAMT state is not an object." };
  for (const key of ["categories", "tags", "actions", "blocks", "actionLogs", "history"]) {
    if (candidate[key] != null && !Array.isArray(candidate[key])) return { ok: false, error: `Stored SAMT ${key} is invalid.` };
  }
  return { ok: true };
}

export function migrateInternalState(candidate, { now, timezone = "Europe/London" }) {
  if (!candidate) return { state: createEmptyState(now, timezone), changed: true, fresh: true };
  const next = deepClone(candidate);
  for (const key of ARRAY_KEYS) if (!Array.isArray(next[key])) next[key] = [];
  next.meta = { ...(next.meta || {}), createdAt: next.meta?.createdAt || now, updatedAt: next.meta?.updatedAt || now, engineArchitecture: "modular-v2" };
  next.settings = {
    ...createEmptyState(now, timezone).settings,
    ...(next.settings || {}),
    timezone: next.settings?.timezone || timezone,
    behaviourDefaults: {
      ...createEmptyState(now, timezone).settings.behaviourDefaults,
      ...(next.settings?.behaviourDefaults || {})
    }
  };
  next.actions = next.actions.map((action) => {
    const sourceCompletion = action.completion || action.completionConfiguration || {};
    const method = sourceCompletion.method || action.completionMethod || "quantity";
    const sourceResult = action.result || action.resultConfiguration || { mode: action.resultType || "none" };
    return {
      ...action,
      direction: action.direction === "avoid" ? "avoid" : "do",
      tagIds: Array.isArray(action.tagIds) ? action.tagIds : [],
      completion: {
        ...sourceCompletion,
        method,
        target: Number(sourceCompletion.target ?? sourceCompletion.minimum ?? 1),
        minimumMinutes: Number(sourceCompletion.minimumMinutes ?? sourceCompletion.minutes ?? (method === "time" ? sourceCompletion.target : 0) ?? 0)
      },
      result: {
        mode: sourceResult.mode || action.resultType || "none",
        scoreMax: sourceResult.scoreMax ?? sourceResult.maximum ?? null,
        unitId: sourceResult.unitId ?? null,
        allowedUnitIds: Array.isArray(sourceResult.allowedUnitIds) ? sourceResult.allowedUnitIds : (sourceResult.unitId ? [sourceResult.unitId] : [])
      }
    };
  });
  next.blocks = next.blocks.map((block) => ({
    ...block,
    direction: block.direction === "avoid" ? "avoid" : "do",
    typeConfig: block.typeConfig || {},
    children: Array.isArray(block.children) ? block.children : [],
    projectTargets: Array.isArray(block.projectTargets) ? block.projectTargets : [],
    completion: block.completion || { mode: ["action_list", "collection"].includes(block.type) ? "open" : "manual", threshold: 0, requiredRelIds: [], afterThreshold: "allow_extra" }
  }));
  const actionsById = new Map(next.actions.map((action) => [action.id, action]));
  next.actionLogs = next.actionLogs.map((log) => ({
    ...log,
    timestamp: log.timestamp || log.eventAt || log.createdAt || now,
    eventAt: log.eventAt || log.timestamp || log.createdAt || now,
    durationPerformed: Number(log.durationPerformed ?? log.durationMinutes ?? log.completionContribution?.durationMinutes ?? 0),
    quantityPerformed: Number(log.quantityPerformed ?? log.quantity ?? log.completionContribution?.quantity ?? 0),
    linkedRunIds: Array.isArray(log.linkedRunIds) ? log.linkedRunIds : Array.from(new Set((log.links || []).map((item) => item.runId).filter(Boolean))),
    linkedOccurrenceIds: Array.isArray(log.linkedOccurrenceIds) ? log.linkedOccurrenceIds : (Array.isArray(log.occurrenceIds) ? log.occurrenceIds : []),
    linkedBlockIds: Array.isArray(log.linkedBlockIds) ? log.linkedBlockIds : Array.from(new Set((log.links || []).flatMap((item) => item.blockPath || []).filter(Boolean))),
    resultTypeSnapshot: log.resultTypeSnapshot || log.result?.mode || "none",
    resultValue: log.resultValue ?? log.result?.value ?? null,
    scoreMaximumSnapshot: log.scoreMaximumSnapshot ?? log.result?.scoreMax ?? null,
    unitId: log.unitId || log.result?.unitId || null,
    unitNameSnapshot: log.unitNameSnapshot || log.result?.unitNameSnapshot || null
  }));
  next.occurrences = next.occurrences.map((occurrence) => {
    const action = actionsById.get(occurrence.actionId);
    const method = action?.completion?.method || "quantity";
    const actual = Number(occurrence.actual ?? (method === "time" ? occurrence.durationMinutesActual : occurrence.quantityActual) ?? 0);
    const logIds = Array.from(new Set([...(occurrence.actionLogIds || []), ...(occurrence.logIds || [])]));
    return {
      ...occurrence,
      parentBlockId: occurrence.parentBlockId || occurrence.blockId || occurrence.contextBlockId || null,
      dueAt: occurrence.dueAt || occurrence.deadlineAt || null,
      expiryPolicy: occurrence.expiryPolicy || occurrence.scheduleSnapshot?.unfinishedPolicy || "carry_forward",
      actual,
      actionLogIds: logIds,
      logIds
    };
  });
  next.runs = next.runs.map((run) => {
    const logIds = Array.from(new Set([...(run.actionLogIds || []), ...(run.logIds || [])]));
    return { ...run, actionLogIds: logIds, logIds };
  });
  next.internalStorageVersion = INTERNAL_STORAGE_VERSION;
  next.appVersion = ENGINE_APP_VERSION;
  next.schemaVersion = next.schemaVersion || LEGACY_SCHEMA_VERSION;
  const changed = Number(candidate.internalStorageVersion || 0) !== INTERNAL_STORAGE_VERSION || JSON.stringify(candidate) !== JSON.stringify(next);
  return { state: next, changed, fresh: false };
}

export function migratePackage(input) {
  const pkg = deepClone(input);
  if (!pkg || pkg.format !== "life-command") return pkg;
  if (Number(pkg.schemaVersion) === 1) {
    pkg.schemaVersion = 2;
    pkg.rootObjectIds = Array.isArray(pkg.rootObjectIds) ? pkg.rootObjectIds : [];
    pkg.data = pkg.data || {};
    pkg.data.blocks = (pkg.data.blocks || []).map((block) => ({ ...block, direction: block.direction === "avoid" ? "avoid" : "do", typeConfig: block.typeConfig || {} }));
    pkg.data.actions = (pkg.data.actions || []).map((action) => ({ ...action, direction: action.direction === "avoid" ? "avoid" : "do" }));
  }
  return pkg;
}
