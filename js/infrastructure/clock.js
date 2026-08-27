export function systemClock() { return { now: () => new Date(), timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }; }

export function fakeClock(initial = new Date(), timezone = "UTC") {
  let current = new Date(initial); return { now: () => new Date(current), timezone: () => timezone, set(value) { current = new Date(value); }, advance(milliseconds) { current = new Date(current.getTime() + Number(milliseconds)); } };
}
