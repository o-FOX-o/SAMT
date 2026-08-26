export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function percentage(actual, target) {
  if (Number(target) === 0) return Number(actual) > 0 ? Infinity : 100;
  return round((Number(actual) / Number(target)) * 100, 2);
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function formatMinutes(total) {
  const value = Math.max(0, Math.round(Number(total) || 0));
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
}
