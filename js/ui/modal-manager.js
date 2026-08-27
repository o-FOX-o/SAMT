export function createModalManager(documentRef = globalThis.document) {
  let active = null; let previousFocus = null;
  function close() { if (!active) return; active.remove(); active = null; documentRef.body?.classList.remove("samt-modal-open"); previousFocus?.focus?.(); previousFocus = null; }
  function open({ title = "Dialog", content = "", actions = [] } = {}) {
    close(); previousFocus = documentRef.activeElement; const backdrop = documentRef.createElement("div"); backdrop.setAttribute("role", "presentation"); backdrop.className = "samt-modal-backdrop"; backdrop.innerHTML = `<div class="samt-modal" role="dialog" aria-modal="true" aria-labelledby="samt-modal-title"><h2 id="samt-modal-title"></h2><div data-modal-content></div><div data-modal-actions></div></div>`; backdrop.querySelector("#samt-modal-title").textContent = title; backdrop.querySelector("[data-modal-content]").innerHTML = content; const actionRoot = backdrop.querySelector("[data-modal-actions]"); for (const action of actions) { const button = documentRef.createElement("button"); button.type = "button"; button.textContent = action.label; button.addEventListener("click", () => action.onClick?.({ close })); actionRoot.append(button); } backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); }); documentRef.body.append(backdrop); documentRef.body.classList.add("samt-modal-open"); active = backdrop; backdrop.querySelector("button, input, select, textarea")?.focus?.(); return { close };
  }
  return { open, close, isOpen: () => Boolean(active) };
}
