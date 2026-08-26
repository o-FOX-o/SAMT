import test from "node:test";
import assert from "node:assert/strict";
import { validateBlockGraph } from "../../js/domain/relationships.js";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { block, deterministicIds, relationship, stateAt } from "../helpers.js";

test("Block graph rejects circular nesting", () => {
  const state = stateAt();
  state.blocks.push(block("a", "A", "collection", [relationship("ra", "block", "b")]), block("b", "B", "collection", [relationship("rb", "block", "a")]));
  assert.throws(() => validateBlockGraph(state), /Circular Block reference/);
});

test("Block graph rejects one Block twice in a root tree but permits reuse in independent roots", () => {
  const shared = block("shared", "Shared", "collection");
  const left = block("left", "Left", "collection", [relationship("rls", "block", "shared")]);
  const right = block("right", "Right", "collection", [relationship("rrs", "block", "shared")]);
  const valid = stateAt();
  valid.blocks.push(shared, left, right);
  assert.equal(validateBlockGraph(valid), true);

  const invalid = stateAt();
  invalid.blocks.push(shared, left, right, block("root", "Root", "collection", [relationship("rrl", "block", "left"), relationship("rrr", "block", "right")]));
  assert.throws(() => validateBlockGraph(invalid), /already exists/);
});

test("failed graph mutation is atomic", async () => {
  const repository = new MemoryRepository(stateAt());
  const engine = new SamtEngine({ repository, clock: new FakeClock("2026-08-24T08:00:00.000Z"), idFactory: deterministicIds() });
  await engine.initialize();
  const first = await engine.createBlock({ name: "First", type: "collection", children: [], completion: { mode: "open", requiredRelIds: [] }, typeConfig: {} });
  const second = await engine.createBlock({ name: "Second", type: "collection", children: [{ id: "rel_second_first", kind: "block", refId: first.value.id }], completion: { mode: "open", requiredRelIds: [] }, typeConfig: {} });
  const before = engine.queries.getState();
  await assert.rejects(() => engine.updateBlock(first.value.id, { children: [{ id: "rel_first_second", kind: "block", refId: second.value.id }] }), /Circular Block reference/);
  assert.deepEqual(engine.queries.getState(), before);
  assert.deepEqual(await repository.load(), before);
});

test("repository commit failure leaves in-memory engine state unchanged", async () => {
  class FailingRepository extends MemoryRepository {
    constructor(initial) { super(initial); this.fail = false; }
    async save(state) { if (this.fail) throw new Error("disk full"); return super.save(state); }
  }
  const repository = new FailingRepository(stateAt());
  const engine = new SamtEngine({ repository, clock: new FakeClock("2026-08-24T08:00:00.000Z"), idFactory: deterministicIds() });
  await engine.initialize();
  repository.fail = true;
  const before = engine.queries.getState();
  await assert.rejects(() => engine.createAction({ name: "Should Roll Back", completion: { method: "quantity", target: 1 }, result: { mode: "none" } }), /disk full/);
  assert.deepEqual(engine.queries.getState(), before);
});
