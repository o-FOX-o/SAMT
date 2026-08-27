import { createEngine } from "./application/engine.js";
import { mountSamtApp } from "./ui/app-shell.js";

const engine = createEngine();
try { engine.reconcile(); } catch { /* lifecycle repair must never block the client */ }
globalThis.SAMT_ENGINE = engine;
if (typeof document !== "undefined") {
  mountSamtApp(engine, document);
  document.documentElement.dataset.samtEngine = "v3";
  document.dispatchEvent(new CustomEvent("samt:engine-ready", { detail: { engine } }));
}
export { engine };
