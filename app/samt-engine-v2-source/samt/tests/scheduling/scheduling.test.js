import test from "node:test";
import assert from "node:assert/strict";
import { calculatePeriodBounds } from "../../js/shared/dates.js";
import { MemoryRepository } from "../../js/infrastructure/repository.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { SamtEngine } from "../../js/application/engine.js";
import { stateAt, action, block, relationship, deterministicIds } from "../helpers.js";

test("local daily bounds follow DST", () => {
  const spring = calculatePeriodBounds({ mode: "day" }, "2026-03-29T12:00:00.000Z", "Europe/London");
  const autumn = calculatePeriodBounds({ mode: "day" }, "2026-10-25T12:00:00.000Z", "Europe/London");
  assert.equal((new Date(spring.end) - new Date(spring.start)) / 3600000, 23);
  assert.equal((new Date(autumn.end) - new Date(autumn.start)) / 3600000, 25);
});

test("daily prayers expire and regenerate idempotently", async () => {
  const state = stateAt();
  for (const name of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha", "Shafaa And Witr"]) state.actions.push(action(`a_${name.replaceAll(" ", "_")}`, name, "quantity"));
  state.blocks.push(block("b_prayers", "Daily Prayers", "routine", state.actions.map((item, index) => relationship(`r_${index}`, "action", item.id)), { suggestedRecurrence: "daily" }));
  const clock = new FakeClock("2026-08-24T09:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  await engine.logAction(state.actions[0].id, { quantityPerformed: 1 });
  await engine.logAction(state.actions[1].id, { quantityPerformed: 1 });
  clock.set("2026-08-25T00:30:00.000Z");
  await engine.reconcileTemporalState();
  await engine.reconcileTemporalState();
  const occurrences = engine.queries.getState().occurrences;
  assert.equal(occurrences.length, 12);
  assert.equal(occurrences.filter((item) => item.status === "completed").length, 2);
  assert.equal(occurrences.filter((item) => item.status === "missed").length, 4);
});

test("Jumuah exists only on Friday and Friday miss closes Saturday", async () => {
  const state = stateAt();
  state.actions.push(action("a_jumuah", "Jumuah", "quantity"));
  state.blocks.push(block("b_friday", "Friday Prayer", "routine", [relationship("r_jumuah", "action", "a_jumuah")], { suggestedWeekday: 5 }));
  const clock = new FakeClock("2026-08-27T10:00:00.000Z");
  const engine = new SamtEngine({ repository: new MemoryRepository(state), clock, idFactory: deterministicIds(), timezone: "Europe/London" });
  await engine.initialize();
  assert.equal(engine.queries.getState().occurrences.length, 0);
  clock.set("2026-08-28T10:00:00.000Z");
  await engine.reconcileTemporalState();
  assert.equal(engine.queries.getState().occurrences.length, 1);
  clock.set("2026-08-29T10:00:00.000Z");
  await engine.reconcileTemporalState();
  const occurrences = engine.queries.getState().occurrences;
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].status, "missed");
});
