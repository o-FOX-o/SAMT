let fallbackSequence = 0;

export function createId(prefix, randomUuid) {
  const generator = randomUuid || (globalThis.crypto && globalThis.crypto.randomUUID ? () => globalThis.crypto.randomUUID() : null);
  fallbackSequence += 1;
  const value = generator ? generator() : `${Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36)}-${fallbackSequence.toString(36)}`;
  return `${prefix}_${value}`;
}

export function stableTemporalId(kind, ownerId, start) {
  const compact = String(start).replace(/[^0-9A-Za-z]/g, "");
  return `${kind}_${ownerId}_${compact}`;
}
