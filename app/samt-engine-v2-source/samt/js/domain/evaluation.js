export function completionPercentage(actual, requirement) {
  if (Number(requirement) === 0) return Number(actual) > 0 ? 100 : 0;
  return Math.min(100, (Number(actual) / Number(requirement)) * 100);
}

export function actionCompletion(action, actual) {
  if (action.completion.method === "time") {
    const minimum = Number(action.completion.minimumMinutes || 0);
    return { actual, requirement: minimum, percentage: minimum === 0 ? (actual > 0 ? 100 : 0) : Math.min(100, (actual / minimum) * 100), complete: minimum === 0 ? actual > 0 : actual >= minimum };
  }
  const target = Number(action.completion.target || 1);
  return { actual, requirement: target, percentage: Math.min(100, (actual / target) * 100), complete: actual >= target };
}
