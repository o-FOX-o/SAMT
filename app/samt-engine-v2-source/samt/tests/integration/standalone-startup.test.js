import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { SamtEngine } from "../../js/application/engine.js";
import { FakeClock } from "../../js/infrastructure/clock.js";
import { LegacyBrowserRepository } from "../../js/infrastructure/repository.js";
import { renderHomeView } from "../../js/ui/home-view.js";
import { modalMarkup } from "../../js/ui/modal-manager.js";
import { deterministicIds } from "../helpers.js";

test("a fresh standalone app works without JSON or browser persistence", async () => {
  const repository = new LegacyBrowserRepository({ indexedDBApi: null, localStorageApi: null });
  const engine = new SamtEngine({
    repository,
    clock: new FakeClock("2026-08-27T12:00:00.000Z"),
    idFactory: deterministicIds()
  });

  const initialized = await engine.initialize();
  assert.equal(initialized.fresh, true);
  assert.equal(engine.queries.getActions().length, 0);
  assert.equal(engine.queries.getBlocks().length, 0);
  assert.deepEqual(repository.getStatus(), {
    persistent: false,
    mode: "memory",
    causes: ["IndexedDB unavailable"]
  });

  const home = engine.queries.getHomeViewModel();
  assert.equal(home.firstUse?.canCreateAction, true);
  assert.match(renderHomeView(home), /Create first Action/);

  await engine.createAction({
    name: "First Action",
    completion: { method: "quantity", target: 1 },
    result: { mode: "none" }
  });
  assert.equal(engine.queries.getActions()[0].name, "First Action");
  assert.equal((await repository.load()).actions[0].name, "First Action");
});

test("information dialogs render one visible Close button", () => {
  const html = modalMarkup({ title: "Storage notice", body: "<p>Message</p>", cancelLabel: "Close" });
  assert.equal((html.match(/>Close<\/button>/g) || []).length, 1);
  assert.equal((html.match(/data-modal-close/g) || []).length, 1);
});

test("the bundled standalone file reaches the empty Home screen with storage APIs absent", async () => {
  const html = fs.readFileSync(new URL("../../dist/samt-app.html", import.meta.url), "utf8");
  const scriptStart = html.lastIndexOf("<script>") + "<script>".length;
  const scriptEnd = html.lastIndexOf("</script>");
  assert.ok(scriptStart > "<script>".length && scriptEnd > scriptStart, "standalone bundle script is missing");

  const appRoot = { innerHTML: "" };
  const modalRoot = { replaceChildren() {} };
  const document = {
    activeElement: null,
    documentElement: { dataset: {} },
    body: { classList: { add() {}, remove() {} }, append() {} },
    getElementById(id) { return id === "app" ? appRoot : id === "modal-root" ? modalRoot : null; },
    addEventListener() {},
    querySelector() { return null; }
  };
  const context = vm.createContext({
    console,
    document,
    location: { search: "", hash: "#/" },
    addEventListener() {},
    URL,
    URLSearchParams,
    Intl,
    structuredClone,
    setTimeout,
    clearTimeout,
    queueMicrotask
  });

  new vm.Script(html.slice(scriptStart, scriptEnd), { filename: "samt-app.html" }).runInContext(context);
  for (let attempt = 0; attempt < 20 && !context.samtEngine; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.ok(context.samtEngine, "SAMT engine did not finish booting");
  assert.match(appRoot.innerHTML, /class="app-shell"/);
  assert.match(appRoot.innerHTML, /Create first Action/);
  assert.doesNotMatch(appRoot.innerHTML, /Your data was not changed/);
});
