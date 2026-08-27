import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { parseRoute } from "../../js/ui/router.js";
import { stateAt, action, block, relationship } from "../helpers.js";
import { getHomeViewModel } from "../../js/application/home.js";
import { normalizeName } from "../../js/shared/validation.js";

test("domain modules import without DOM globals", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  delete globalThis.document;
  delete globalThis.window;
  const modules = readdirSync(new URL("../../js/domain/", import.meta.url)).filter((name) => name.endsWith(".js"));
  await Promise.all(modules.map((name) => import(`../../js/domain/${name}`)));
  assert.equal(globalThis.document, undefined);
  if (previousDocument) globalThis.document = previousDocument;
  if (previousWindow) globalThis.window = previousWindow;
});

test("domain and application sources have no DOM, storage, network, or hidden clock dependency", () => {
  for (const directory of ["domain", "application"]) {
    for (const name of readdirSync(new URL(`../../js/${directory}/`, import.meta.url)).filter((item) => item.endsWith(".js"))) {
      const source = readFileSync(new URL(`../../js/${directory}/${name}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /\bdocument\s*\.|\bwindow\s*\.|globalThis\.(?:document|window|localStorage|indexedDB)|\bHTMLElement\b|\blocalStorage\s*\.|\bindexedDB\s*\.|\bfetch\s*\(|Date\.now\s*\(/, `${directory}/${name} crossed an architecture boundary`);
    }
  }
});

test("module imports enforce Domain and Application dependency direction", () => {
  for (const name of readdirSync(new URL("../../js/domain/", import.meta.url)).filter((item) => item.endsWith(".js"))) {
    const source = readFileSync(new URL(`../../js/domain/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*\/(?:ui|application|infrastructure|import-export)\//, `domain/${name} imports an outer layer`);
  }
  for (const name of readdirSync(new URL("../../js/application/", import.meta.url)).filter((item) => item.endsWith(".js"))) {
    const source = readFileSync(new URL(`../../js/application/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*\/ui\//, `application/${name} imports the UI`);
  }
});

test("SAMT names preserve multilingual text while normalising unsafe whitespace", () => {
  assert.equal(normalizeName("  صلاة\nالفجر  "), "صلاة الفجر");
  assert.equal(normalizeName("普通话词汇"), "普通话词汇");
  assert.equal(normalizeName("Chest\u0000 Training"), "Chest Training");
});

test("public core entry imports without a browser UI", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  try {
    delete globalThis.document;
    delete globalThis.window;
    const core = await import("../../js/core.js");
    assert.equal(typeof core.calculateTargetProgress, "function");
    assert.equal(typeof core.evaluateAvoidPeriod, "function");
    assert.equal(typeof core.SamtEngine, "function");
  } finally {
    if (previousDocument !== undefined) globalThis.document = previousDocument;
    if (previousWindow !== undefined) globalThis.window = previousWindow;
  }
});

test("Open and Edit routes are distinct", () => {
  assert.deepEqual(parseRoute("#/blocks/block_one"), { name: "block-detail", path: "/blocks/block_one", id: "block_one" });
  assert.deepEqual(parseRoute("#/blocks/block_one/edit"), { name: "block-edit", path: "/blocks/block_one/edit", id: "block_one" });
});

test("Home view model separates positive Due and Avoid", () => {
  const state = stateAt();
  state.actions.push(action("a_do", "Do Work", "time", "do"), action("a_avoid", "Gaming", "time", "avoid"));
  state.blocks.push(block("b_list", "Self Control", "action_list", [relationship("r_avoid", "action", "a_avoid", { avoidEvaluation: { mode: "binary_limit", metric: "time", binaryLimit: 0, period: { mode: "day" } } })]));
  state.occurrences.push({ id: "o_do", actionId: "a_do", parentBlockId: "b_positive", availableAt: "2026-08-24T08:00:00.000Z", dueAt: "2026-08-24T12:00:00.000Z", status: "due", actionLogIds: [] });
  const model = getHomeViewModel(state, { now: "2026-08-24T10:00:00.000Z", timezone: "Europe/London" });
  assert.equal(model.due.dueNow.length, 1);
  assert.equal(model.avoid.length, 1);
  assert.equal(model.due.dueNow.some((item) => item.actionId === "a_avoid"), false);
});
