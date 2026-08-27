import test from "node:test";
import assert from "node:assert/strict";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository, selectBestStateCandidate } from "../../js/infrastructure/repository.js";
import { deterministicIds, stateAt } from "../helpers.js";

test("storage recovery selects the newest factual snapshot and uses source priority only as a tie-breaker", () => {
  const olderPrimary = stateAt("2026-08-20T08:00:00.000Z");
  olderPrimary.meta.updatedAt = "2026-08-20T09:00:00.000Z";
  olderPrimary.history.push({ id: "history_old", timestamp: olderPrimary.meta.updatedAt });
  const newerFallback = stateAt("2026-08-20T08:00:00.000Z");
  newerFallback.meta.updatedAt = "2026-08-20T10:00:00.000Z";
  const selected = selectBestStateCandidate([
    { source: "indexedDB:life-command-v1-state", value: olderPrimary },
    { source: "localStorage:life-command-v1-fallback", value: newerFallback }
  ]);
  assert.equal(selected.value.meta.updatedAt, newerFallback.meta.updatedAt);

  newerFallback.meta.updatedAt = olderPrimary.meta.updatedAt;
  const tie = selectBestStateCandidate([
    { source: "localStorage:life-command-v1-fallback", value: newerFallback },
    { source: "indexedDB:life-command-v1-state", value: olderPrimary }
  ]);
  assert.equal(tie.source, "indexedDB:life-command-v1-state");
});

test("a pre-migration backup is exact, versioned, and never overwritten by later saves", async () => {
  const legacy = stateAt();
  legacy.internalStorageVersion = 1;
  legacy.appVersion = "1.12.0";
  legacy.history.push({ id: "legacy_history", type: "fact", timestamp: "2026-08-24T08:00:00.000Z" });
  const untouched = structuredClone(legacy);
  const repository = new MemoryRepository(legacy);
  const engine = new SamtEngine({ repository, clock: new FakeClock("2026-08-24T10:00:00.000Z"), idFactory: deterministicIds() });
  await engine.initialize();
  assert.equal(repository.backups.length, 1);
  assert.deepEqual(repository.backups[0], untouched);
  await engine.createAction({ name: "After Migration", completion: { method: "quantity", target: 1 }, result: { mode: "none" } });
  await engine.initialize();
  assert.equal(repository.backups.length, 1);
  assert.deepEqual(repository.backups[0], untouched);
});

test("failed migration validation never commits or replaces the original state", async () => {
  const invalid = stateAt();
  invalid.internalStorageVersion = 1;
  invalid.actions.push(
    { id: "duplicate", name: "One", tagIds: [], completion: { method: "quantity", target: 1 }, result: { mode: "none" }, status: "active" },
    { id: "duplicate", name: "Two", tagIds: [], completion: { method: "quantity", target: 1 }, result: { mode: "none" }, status: "active" }
  );
  const repository = new MemoryRepository(invalid);
  const before = await repository.load();
  const engine = new SamtEngine({ repository, clock: new FakeClock("2026-08-24T10:00:00.000Z"), idFactory: deterministicIds() });
  await assert.rejects(() => engine.initialize(), /migration was not committed/i);
  assert.deepEqual(await repository.load(), before);
  assert.equal(repository.backups.length, 1);
  assert.deepEqual(repository.backups[0], before);
});
