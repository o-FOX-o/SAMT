import { createEngine } from "./application/engine.js";
import { mountV3Panel } from "./ui/v3-panel.js";

// The existing Version 2 client remains the visible reference UI. This bridge
// makes the V3 engine available to a future UI without changing V2 startup.
const engine = createEngine();
try { engine.reconcile(); } catch { /* lifecycle repair must never block the client */ }
globalThis.SAMT_ENGINE = engine;
if (typeof document !== "undefined") {
  mountV3Panel(engine, document);
  document.documentElement.dataset.samtEngine = "v3";
  document.dispatchEvent(new CustomEvent("samt:engine-ready", { detail: { engine } }));
}
export { engine };
