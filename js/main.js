import { createEngine } from "./application/engine.js";
import { mountSamtApp } from "./ui/app-shell.js";

const engine = createEngine();
try { engine.reconcile(); } catch { /* lifecycle repair must never block the client */ }
globalThis.SAMT_ENGINE = engine;
if (typeof document !== "undefined") {
  document.documentElement.dataset.samtEngine = "v3";
  try {
    mountSamtApp(engine, document);
  } catch (error) {
    // A UI adapter failure must never turn a valid local engine into a blank
    // page. The data remains available through SAMT_ENGINE and the user gets
    // an actionable V3 recovery surface instead of a fatal startup error.
    const root = document.getElementById("app") || document.body;
    if (root) root.innerHTML = `<main class="samt-startup-error" role="alert"><h1>SAMT V3 is still open</h1><p>The interface could not finish mounting, but your local engine is available in memory. Reload the page or export a backup after the interface returns.</p><details><summary>Technical detail</summary><pre>${String(error?.message || error).replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[character]))}</pre></details></main>`;
  }
  if (typeof CustomEvent === "function") document.dispatchEvent(new CustomEvent("samt:engine-ready", { detail: { engine } }));
}
export { engine, createEngine };
