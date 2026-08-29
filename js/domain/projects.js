import { finiteNumber } from "../shared/numbers.js";
import { compareValues } from "./targets.js";
import { convertValue, isCompatible, unitMap } from "./units.js";
import { choiceAnalyticalValue, normalizeResultConfig } from "./results.js";
import { ValidationError } from "../shared/errors.js";
import { clone } from "../shared/validation.js";

export const PROJECT_CHILD_STATES = ["LOCKED", "AVAILABLE", "IN_PROGRESS", "COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "OVERDUE", "BLOCKED", "CANCELLED"];

function isSatisfied(item = {}) { return ["COMPLETED", "EXCUSED", "NOT_APPLICABLE", "completed", "excused", "not_applicable"].includes(item.state || item.status); }
function projectConfig(project = {}) { return project?.config || project?.snapshot?.config || project?.snapshot?.block?.config || project || {}; }
function projectRelationships(project = {}) { return project?.relationships || project?.snapshot?.relationships || project?.snapshot?.block?.relationships || []; }
function resultValue(value) { return value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value") ? value.value : value; }

export function evaluateProjectCondition(condition = {}, context = {}) {
  if (condition.type === "all_required") return (context.required || []).every((item) => item.satisfied ?? isSatisfied(item));
  if (condition.type === "count") return (context.completedCount || 0) >= finiteNumber(condition.value);
  if (condition.type === "percentage") return (context.completedPercentage || 0) >= finiteNumber(condition.value);
  if (condition.type === "target") return Boolean(context.targets?.[condition.targetId]?.reached);
  if (condition.type === "milestone") return Boolean(context.milestones?.[condition.milestoneId]?.satisfied ?? context.milestones?.[condition.milestoneId]?.status === "completed");
  if (condition.type === "result") {
    const actualEntry = context.results?.[condition.fieldId]; const actual = resultValue(actualEntry); const field = context.resultFields?.[condition.fieldId]; if (actual == null) return false;
    if (field?.type === "choice") {
      const config = normalizeResultConfig(field);
      if (condition.operator === "=" || condition.operator == null) { const left = Array.isArray(actual) ? [...actual].sort() : [actual]; const right = Array.isArray(condition.value) ? [...condition.value].sort() : [condition.value]; return left.length === right.length && left.every((value, index) => value === right[index]); }
      if (!config.orderMatters || config.betterDirection === "none") return false;
      const left = choiceAnalyticalValue(field, actual); const right = choiceAnalyticalValue(field, condition.value); return left != null && right != null && compareValues(left, condition.operator || ">=", right);
    }
    if (field?.type === "measurement" && actualEntry && typeof actualEntry === "object") {
      const expectedUnit = condition.unitId || field.config?.defaultUnitId; const actualUnit = actualEntry.unitId || field.config?.defaultUnitId; const units = context.units || [];
      if (expectedUnit && actualUnit) { const map = unitMap(units); if (!map.has(expectedUnit) || !map.has(actualUnit) || !isCompatible(actualUnit, expectedUnit, units)) throw new ValidationError("Project Result condition uses incompatible Units."); }
      const value = expectedUnit && actualUnit ? convertValue(actualEntry.value, actualUnit, expectedUnit, units) : Number(actualEntry.value);
      return Number.isFinite(value) && compareValues(value, condition.operator || ">=", finiteNumber(condition.value));
    }
    return compareValues(typeof actual === "number" ? actual : finiteNumber(actual, NaN), condition.operator || ">=", finiteNumber(condition.value));
  }
  if (condition.type === "manual") return Boolean(context.manual);
  return false;
}

export function evaluateProjectConditions({ conditions = [], context = {}, combination = "all" } = {}) {
  const results = conditions.map((condition) => ({ condition, satisfied: evaluateProjectCondition(condition, context) }));
  return { satisfied: combination === "any" ? results.some((result) => result.satisfied) : results.every((result) => result.satisfied), results };
}

export function createMilestone({ id, name, description = "", dueAt = null, required = false, status = "open", condition = null, now = new Date() } = {}) {
  if (!id || !String(name || "").trim()) throw new ValidationError("Milestone requires an ID and name.");
  if (!["open", "completed", "missed", "cancelled"].includes(status)) throw new ValidationError("Milestone status is invalid.");
  const stamp = new Date(now).toISOString();
  return { id, name: String(name).trim(), description: String(description || ""), dueAt, required: Boolean(required), condition: clone(condition), status, createdAt: stamp, updatedAt: stamp };
}

export function initializeProjectRuntime({ project = {}, now = new Date() } = {}) {
  const stamp = new Date(now).toISOString();
  const children = projectRelationships(project).map((relationship, position) => {
    const config = relationship.config || {}; const dependencyIds = [...new Set(config.dependsOnRelationshipIds || config.dependencyIds || config.dependsOn || [])];
    return { id: relationship.id, relationshipId: relationship.id, kind: relationship.kind, refId: relationship.refId, label: relationship.label || null, position, required: config.required !== false, dependencyIds, allowSkip: config.allowSkip === true, requireSkipReason: config.requireSkipReason === true, allowExcuse: config.allowExcuse === true || config.excuseAllowed === true, allowNotApplicable: config.allowNotApplicable === true || config.allowNA === true, availableFrom: config.availableFrom || config.timing?.availableFrom || null, deadline: config.deadline || config.timing?.deadline || null, state: dependencyIds.length ? "LOCKED" : "AVAILABLE", reason: null, logIds: [], createdAt: stamp, updatedAt: stamp };
  });
  const milestones = (projectConfig(project).milestones || []).map((milestone, index) => createMilestone({ ...milestone, id: milestone.id || "milestone_" + (index + 1), now }));
  return { type: "project", children, milestones, conditions: clone(projectConfig(project).conditions || [{ type: "all_required" }]), plannedStart: projectConfig(project).plannedStart || null, actualStart: null, scopeBaseline: clone(projectRelationships(project)), startedAt: stamp, updatedAt: stamp };
}

export function projectProgressFromRun(run = {}) {
  const children = run.children || run.runtime?.children || []; const required = children.filter((child) => child.required !== false); const satisfied = required.filter(isSatisfied);
  return { total: children.length, completed: children.filter(isSatisfied).length, requiredCount: required.length, requiredCompleted: satisfied.length, percentage: children.length ? children.filter(isSatisfied).length / children.length * 100 : 0, required, completedCount: satisfied.length, completedPercentage: required.length ? satisfied.length / required.length * 100 : 0 };
}

function projectChildrenForEvaluation(run, now) {
  const source = run?.children || run?.runtime?.children || [];
  const satisfiedIds = new Set(source.filter(isSatisfied).map((child) => child.relationshipId || child.id));
  const current = new Date(now);
  return source.map((child) => {
    if (["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE", "CANCELLED", "BLOCKED"].includes(child.state)) return child;
    const dependencyIds = child.dependencyIds || [];
    if (dependencyIds.some((id) => !satisfiedIds.has(id))) return { ...child, state: "LOCKED", available: false };
    if (child.availableFrom && Number.isFinite(new Date(child.availableFrom).getTime()) && current < new Date(child.availableFrom)) {
      return { ...child, state: "LOCKED", available: false };
    }
    if (child.deadline && Number.isFinite(new Date(child.deadline).getTime()) && current >= new Date(child.deadline)) {
      return { ...child, state: "OVERDUE", available: true, overdueAt: child.overdueAt || current.toISOString() };
    }
    return { ...child, state: child.state === "LOCKED" ? "AVAILABLE" : child.state, available: true };
  });
}

export function evaluateProjectRun({ project = null, run = null, required = [], completedCount = 0, completedPercentage = 0, targets = {}, results = {}, milestones = {}, manual = false, resultFields = {}, units = [], now = new Date(), finished = false } = {}) {
  const source = project || run?.snapshot?.block || run?.snapshot || {};
  const config = projectConfig(source);
  const evaluatedChildren = run ? projectChildrenForEvaluation(run, now) : [];
  const evaluatedRun = run ? { ...run, children: evaluatedChildren } : null;
  const progress = run ? projectProgressFromRun(evaluatedRun) : { required, completedCount, completedPercentage };
  const runtimeMilestones = Array.isArray(run?.runtime?.milestones)
    ? Object.fromEntries(run.runtime.milestones.map((milestone) => [milestone.id, milestone]))
    : (run?.runtime?.milestones || {});
  const conditionResult = evaluateProjectConditions({
    conditions: config.conditions || [{ type: "all_required" }],
    context: {
      required: progress.required || required,
      completedCount: progress.completedCount ?? completedCount,
      completedPercentage: progress.completedPercentage ?? completedPercentage,
      targets,
      results,
      milestones: { ...runtimeMilestones, ...milestones },
      manual,
      resultFields,
      units
    },
    combination: config.combination || "all"
  });
  const qualified = conditionResult.satisfied;
  const deadline = run?.deadline || config.deadline || null;
  const deadlineReached = Boolean(deadline && new Date(now) >= new Date(deadline));
  const finishBehaviour = config.finishBehaviour || "ready";
  let status = "NOT_STARTED";
  if (finished && qualified) status = "COMPLETED";
  else if (qualified) status = finishBehaviour === "auto" ? "COMPLETED" : "READY_TO_FINISH";
  else if (deadlineReached && config.deadlinePolicy === "hard_expiry") status = "EXPIRED";
  else if (deadlineReached) status = "OVERDUE";
  else if ((progress.completedCount ?? completedCount) > 0 || (progress.completedPercentage ?? completedPercentage) > 0) status = "IN_PROGRESS";
  return { ...conditionResult, qualified, readyToFinish: qualified && status === "READY_TO_FINISH", progress, children: evaluatedChildren, status, deadlineReached };
}

export function updateProjectChild({ run, relationshipId, state, logId = null, reason = null, now = new Date() } = {}) {
  if (!run || !relationshipId || !PROJECT_CHILD_STATES.includes(state)) throw new ValidationError("Project child update is invalid.");
  const stamp = new Date(now).toISOString(); const source = run.children || run.runtime?.children || []; const current = source.find((child) => child.relationshipId === relationshipId || child.id === relationshipId);
  if (!current) throw new ValidationError("Project child does not exist.");
  if (["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE"].includes(current.state) && state !== current.state) throw new ValidationError("A terminal Project child must be reopened explicitly.");
  if (["COMPLETED", "SKIPPED", "EXCUSED", "NOT_APPLICABLE"].includes(state) && current.state === "LOCKED") throw new ValidationError("This Project child is locked by an unresolved dependency or availability rule.");
  if (state === "SKIPPED" && current.required) throw new ValidationError("Required Project children cannot be skipped.");
  if (state === "SKIPPED" && current.allowSkip !== true) throw new ValidationError("Skipping this Project child is not allowed.");
  if (state === "SKIPPED" && current.requireSkipReason && !String(reason || "").trim()) throw new ValidationError("A skip reason is required.");
  if (state === "EXCUSED" && current.allowExcuse !== true) throw new ValidationError("Excusing this Project child is not allowed.");
  if (state === "NOT_APPLICABLE" && current.allowNotApplicable !== true) throw new ValidationError("Marking this Project child not applicable is not allowed.");
  const children = source.map((child) => child.relationshipId === relationshipId || child.id === relationshipId ? { ...child, state, logIds: logId ? [...new Set([...(child.logIds || []), logId])] : [...(child.logIds || [])], reason: reason || null, updatedAt: stamp } : child);
  const dependencyIds = new Set(children.filter(isSatisfied).map((child) => child.relationshipId || child.id)); const unlocked = children.map((child) => child.state === "LOCKED" && (child.dependencyIds || []).every((id) => dependencyIds.has(id)) ? { ...child, state: "AVAILABLE" } : child);
  return { ...run, children: unlocked, runtime: { ...(run.runtime || {}), type: "project", children: clone(unlocked), progress: projectProgressFromRun({ children: unlocked }), updatedAt: stamp }, updatedAt: stamp };
}

export function applyProjectScopeChange({ run, project, changes = [], now = new Date() } = {}) {
  if (!run || !project) throw new ValidationError("Project scope change requires a Run and Project.");
  const stamp = new Date(now).toISOString(); const relationships = projectRelationships(project); const byId = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  let children = (run.children || run.runtime?.children || []).map((child) => {
    const relationship = byId.get(child.relationshipId || child.id); if (!relationship) return { ...child, required: false, scopeRemoved: true, scopeRemovedAt: child.scopeRemovedAt || stamp, state: child.state === "COMPLETED" ? child.state : "CANCELLED", updatedAt: stamp };
    const config = relationship.config || {};
    return { ...child, label: relationship.label || child.label || null, required: config.required !== false, dependencyIds: [...new Set(config.dependsOnRelationshipIds || config.dependencyIds || config.dependsOn || child.dependencyIds || [])], allowSkip: config.allowSkip === true, requireSkipReason: config.requireSkipReason === true, allowExcuse: config.allowExcuse === true || config.excuseAllowed === true, allowNotApplicable: config.allowNotApplicable === true || config.allowNA === true, availableFrom: config.availableFrom || config.timing?.availableFrom || null, deadline: config.deadline || config.timing?.deadline || null, scopeUpdatedAt: stamp, updatedAt: stamp };
  });
  for (const relationship of relationships) if (!children.some((child) => child.relationshipId === relationship.id)) {
    const config = relationship.config || {};
    children.push({ id: relationship.id, relationshipId: relationship.id, kind: relationship.kind, refId: relationship.refId, label: relationship.label || null, position: children.length, required: config.required !== false, dependencyIds: [...new Set(config.dependsOnRelationshipIds || config.dependencyIds || config.dependsOn || [])], allowSkip: config.allowSkip === true, requireSkipReason: config.requireSkipReason === true, allowExcuse: config.allowExcuse === true || config.excuseAllowed === true, allowNotApplicable: config.allowNotApplicable === true || config.allowNA === true, availableFrom: config.availableFrom || config.timing?.availableFrom || null, deadline: config.deadline || config.timing?.deadline || null, state: "AVAILABLE", reason: null, logIds: [], createdAt: stamp, updatedAt: stamp });
  }
  children = children.map((child) => child.state === "AVAILABLE" && child.dependencyIds?.length ? { ...child, state: "LOCKED" } : child);
  const scopeChanges = [...(run.runtime?.scopeChanges || []), ...changes.map((change) => ({ ...clone(change), changedAt: stamp }))];
  return { ...run, children, runtime: { ...(run.runtime || {}), type: "project", children: clone(children), progress: projectProgressFromRun({ children }), scopeBaseline: run.runtime?.scopeBaseline || clone(run.snapshot?.relationships || []), scopeChanges, updatedAt: stamp }, updatedAt: stamp };
}

export function updateMilestone({ run, milestoneId, patch = {}, now = new Date() } = {}) {
  const milestones = (run?.runtime?.milestones || []).map((milestone) => milestone.id === milestoneId ? { ...milestone, ...clone(patch), id: milestoneId, updatedAt: new Date(now).toISOString() } : milestone);
  if (!milestones.some((milestone) => milestone.id === milestoneId)) throw new ValidationError("Project milestone does not exist.");
  return { ...run, runtime: { ...(run.runtime || {}), milestones, updatedAt: new Date(now).toISOString() }, updatedAt: new Date(now).toISOString() };
}

export function diffProjectScope(before = {}, after = {}) {
  const beforeRelationships = new Map(projectRelationships(before).map((relationship) => [relationship.id, relationship])); const afterRelationships = new Map(projectRelationships(after).map((relationship) => [relationship.id, relationship])); const changes = [];
  for (const [id, relationship] of afterRelationships) if (!beforeRelationships.has(id)) changes.push({ type: "relationship_added", relationshipId: id, after: clone(relationship) });
  for (const [id, relationship] of beforeRelationships) if (!afterRelationships.has(id)) changes.push({ type: "relationship_removed", relationshipId: id, before: clone(relationship) });
  for (const [id, relationship] of afterRelationships) if (beforeRelationships.has(id) && JSON.stringify(beforeRelationships.get(id)) !== JSON.stringify(relationship)) changes.push({ type: "relationship_changed", relationshipId: id, before: clone(beforeRelationships.get(id)), after: clone(relationship) });
  return changes;
}
