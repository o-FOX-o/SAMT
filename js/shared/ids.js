export function createId(prefix = "id", now = new Date(), random = Math.random) {
  const time = Number(now instanceof Date ? now.getTime() : now) || 0;
  const entropy = Math.floor(Math.max(0, Math.min(0xffffff, random() * 0x1000000)))
    .toString(36).padStart(4, "0");
  return `${prefix}_${time.toString(36)}_${entropy}`;
}

export function makeIdFactory({ clock = () => new Date(), random = Math.random } = {}) {
  return (prefix) => createId(prefix, clock(), random);
}

export function isStableId(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{1,199}$/.test(value);
}
