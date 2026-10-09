// SAMT data consists of plain objects, arrays and primitive values. Copy it
// without requiring structuredClone (missing from WebViews before Chromium 98).
// Unlike a JSON round trip, this keeps optional undefined fields in memory.
export function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneData(item)]));
  }
  return value;
}
