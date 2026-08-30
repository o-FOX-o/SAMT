import { getDueOccurrences, getRunningRuns, getUpcomingOccurrences } from "./selectors.js";
import { calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidFromLogs } from "../domain/avoid.js";
import { calculatePeriodBounds, partsInTimeZone } from "../shared/dates.js";
import { getCurrentCyclePosition } from "../domain/cycles.js";

function occurrenceRelationship(state, occurrence) {
  return (state.blocks || []).flatMap((block) => block.relationships || []).find((candidate) => candidate.id === occurrence.relationshipId) || null;
}

function occurrenceAction(state, occurrence) {
  const relationship = occurrenceRelationship(state, occurrence);
  return state.actions.find((action) => action.id === (relationship?.refId || occurrence.snapshot?.actionId)) || null;
}

function isPositiveOccurrence(state, occurrence) {
  return occurrenceAction(state, occurrence)?.direction !== "avoid";
}

function isRequiredOccurrence(state, occurrence) {
  return occurrenceRelationship(state, occurrence)?.config?.required === true;
}

function targetDeficit(progress = {}, config = {}) {
  const actual = Number(progress.actual);
  const target = Number(progress.targetValue ?? config.targetValue);
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return 0;
  if ([">=", ">"].includes(config.comparison || ">=")) return Math.max(0, target - actual);
  if (["<=", "<"].includes(config.comparison)) return Math.max(0, actual - target);
  return Math.abs(target - actual);
}

function targetUrgency(row, now) {
  if (row.progress?.reached || row.progress?.status === "OVER_TARGET") return -1;
  const end = row.period?.end || row.deadlineAt;
  const remainingDays = end ? Math.max(1 / 24, (new Date(end).getTime() - new Date(now).getTime()) / 86400000) : 365;
  return targetDeficit(row.progress, row.config) / remainingDays + (row.deadlineAt ? 1 / remainingDays : 0);
}

export function getHomeViewModel({ state, now = new Date(), timezone = state?.settings?.timezone || "UTC" } = {}) {
  const safeState = state || { actions: [], blocks: [], occurrences: [], actionLogs: [], settings: {} };
  const running = getRunningRuns(safeState);
  const allDue = getDueOccurrences(safeState, now);
  const due = allDue.filter((occurrence) => isPositiveOccurrence(safeState, occurrence));
  const requiredDue = due.filter((occurrence) => isRequiredOccurrence(safeState, occurrence));
  const avoid = [];
  for (const action of safeState.actions || []) if (action.direction === "avoid") {
    const config = action.avoid || action.legacy?.avoid;
    const period = config?.period && !["session", "all_time"].includes(config.period) ? calculatePeriodBounds({ period: config.period, style: config.periodStyle || "calendar", at: now, timezone, weekStartsOn: config.weekStartsOn ?? safeState.settings?.weekStartsOn ?? 1 }) : null;
    let result = { actual: 0, logs: [] };
    if (config) {
      try { result = evaluateAvoidFromLogs({ actionId: action.id, logs: safeState.actionLogs || [], config, period }); }
      catch (error) { result = { actual: 0, logs: [], status: "INVALID", error: error.message }; }
    }
    avoid.push({ actionId: action.id, name: action.name, metric: config?.metric || "duration", status: config ? result.status : "UNCONFIGURED", ...result });
  }
  const targetRows = (safeState.blocks || []).filter((block) => block.type === "target" && block.definitionStatus === "ACTIVE").map((target) => {
    const config = target.config || {};
    const period = config.period && !["session", "all_time"].includes(config.period) ? calculatePeriodBounds({ period: config.period, style: config.periodStyle || "calendar", at: now, timezone: config.timezone || timezone, weekStartsOn: config.weekStartsOn ?? safeState.settings?.weekStartsOn ?? 1, rollingWindowDays: config.rollingWindowDays, customStart: config.customStart, customEnd: config.customEnd }) : null;
    let progress;
    try { progress = calculateTargetProgress({ target, logs: safeState.actionLogs || [], period, actions: safeState.actions || [], blocks: safeState.blocks || [], units: safeState.units || [] }); }
    catch (error) { progress = { status: "NOT_CONFIGURED", actual: null, targetValue: config.targetValue ?? 0, percentage: 0, error: error.message }; }
    return { targetId: target.id, name: target.name, period: config.period || "all_time", periodBounds: period, deadlineAt: config.deadline || null, config, progress };
  });
  const today = targetRows.filter((target) => target.period === "day" || target.period === "session");
  const thisWeek = targetRows.filter((target) => target.period === "week");
  const cycleNow = (safeState.blocks || []).filter((block) => block.type === "cycle" && block.definitionStatus === "ACTIVE").map((cycle) => {
    const big = (safeState.cycleBigCycles || []).filter((item) => item.cycleId === cycle.id && item.status === "open").at(-1);
    const small = big ? (safeState.cycleSmallCycles || []).find((item) => item.id === big.currentSmallCycleId) : null;
    const currentIndex = Number(big?.currentSlot ?? -1);
    const generatedItem = small && currentIndex >= 0 && currentIndex < (small.slots || []).length
      ? small.slots[currentIndex]
      : currentIndex === -1 ? small?.slots?.[0] || null : null;
    return { cycleId: cycle.id, name: cycle.name, position: generatedItem || getCurrentCyclePosition(cycle), generated: Boolean(generatedItem), currentSlot: generatedItem };
  });
  const projects = (safeState.blocks || []).filter((block) => block.type === "project" && block.definitionStatus === "ACTIVE");
  const primaryId = safeState.settings?.primaryProjectId;
  const currentProject = projects.find((project) => project.id === primaryId) || null;
  const localToday = partsInTimeZone(now, timezone);
  const todayKey = String(localToday.year) + "-" + String(localToday.month).padStart(2, "0") + "-" + String(localToday.day).padStart(2, "0");
  const upcoming = getUpcomingOccurrences(safeState, now, 20).filter((occurrence) => isPositiveOccurrence(safeState, occurrence)).slice(0, 5);
  const laterToday = getUpcomingOccurrences(safeState, now, 20).filter((occurrence) => String(occurrence.scheduledAt || "").startsWith(todayKey) && isPositiveOccurrence(safeState, occurrence)).slice(0, 5);
  const overdue = requiredDue.filter((occurrence) => occurrence.status === "overdue");
  const dueNow = requiredDue.filter((occurrence) => occurrence.status !== "overdue");
  const targetDeficits = targetRows.filter((row) => !row.progress?.reached && row.progress?.status !== "OVER_TARGET").sort((a, b) => targetUrgency(b, now) - targetUrgency(a, now));
  let choice;
  if (running.length) choice = { type: "running", items: running };
  else if (overdue.length) choice = { type: "overdue", items: overdue };
  else if (dueNow.length) choice = { type: "due", items: dueNow };
  else if (cycleNow.some((cycle) => cycle.position)) choice = { type: "cycle", items: cycleNow };
  else if (targetDeficits.length) choice = { type: "target", items: targetDeficits.slice(0, 3) };
  else choice = { type: "next", items: upcoming };
  return { now: { at: new Date(now).toISOString(), choice, running, cycle: cycleNow }, due: { overdue, dueNow, laterToday, all: due }, avoid, today, thisWeek, targets: targetRows, currentProject, upcoming, timezone };
}
