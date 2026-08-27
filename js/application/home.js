import { getDueOccurrences, getRunningRuns, getUpcomingOccurrences } from "./selectors.js";
import { calculateTargetProgress } from "../domain/targets.js";
import { evaluateAvoidFromLogs } from "../domain/avoid.js";

export function getHomeViewModel({ state, now = new Date(), timezone = state?.settings?.timezone || "UTC" } = {}) {
  const running = getRunningRuns(state); const due = getDueOccurrences(state, now); const avoid = [];
  for (const action of state.actions || []) if (action.direction === "avoid") { const config = action.avoid || action.legacy?.avoid; if (config) avoid.push({ actionId: action.id, name: action.name, ...evaluateAvoidFromLogs({ actionId: action.id, logs: state.actionLogs || [], config, period: null }) }); }
  const targets = (state.blocks || []).filter((block) => block.type === "target" && block.definitionStatus === "ACTIVE").map((target) => ({ targetId: target.id, name: target.name, progress: calculateTargetProgress({ target, logs: state.actionLogs || [], period: null, actions: state.actions || [], units: state.units || [] }) }));
  const nowChoice = running.length ? { type: "running", items: running } : due.length ? { type: "due", items: due } : { type: "next", items: getUpcomingOccurrences(state, now, 5) };
  const today = targets.filter((target) => ["day", "session"].includes(target.progress?.period || target.period)); const thisWeek = targets.filter((target) => target.progress?.period === "week" || target.period === "week");
  const projects = (state.blocks || []).filter((block) => block.type === "project" && block.definitionStatus === "ACTIVE"); const primaryId = state.settings?.primaryProjectId; const currentProject = projects.find((project) => project.id === primaryId) || projects[0] || null;
  return { now: { choice: nowChoice, running }, due: { overdue: due.filter((occurrence) => occurrence.status === "overdue"), dueNow: due.filter((occurrence) => occurrence.status !== "overdue"), laterToday: [] }, avoid, today, thisWeek, currentProject, upcoming: getUpcomingOccurrences(state, now, 5), timezone };
}
