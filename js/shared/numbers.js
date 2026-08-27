export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function nonNegative(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

export function positiveInteger(value, fallback = 1) {
  const number = Math.round(finiteNumber(value, fallback));
  return number >= 1 ? number : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

export function percentage(actual, target) {
  const a = finiteNumber(actual);
  const t = finiteNumber(target);
  return t === 0 ? (a > 0 ? Infinity : 100) : (a / t) * 100;
}
