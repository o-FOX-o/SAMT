export function createModalManager(documentRef = globalThis.document) {
  let active = null;
  let previousFocus = null;

  function close() {
    if (!active) return;
    active.remove();
    active = null;
    documentRef.body?.classList.remove("samt-modal-open");
    previousFocus?.focus?.();
    previousFocus = null;
  }

  function open({ title = "Dialog", content = "", actions = [] } = {}) {
    close();
    previousFocus = documentRef.activeElement;
    const backdrop = documentRef.createElement("div");
    backdrop.setAttribute("role", "presentation");
    backdrop.className = "samt-modal-backdrop";
    backdrop.innerHTML = `<div class="samt-modal" role="dialog" aria-modal="true" aria-labelledby="samt-modal-title"><header class="samt-modal-head"><h2 id="samt-modal-title"></h2><button type="button" class="samt-modal-close" data-modal-close aria-label="Close dialog">×</button></header><div data-modal-content></div><div data-modal-actions></div></div>`;
    backdrop.querySelector("#samt-modal-title").textContent = title;
    backdrop.querySelector("[data-modal-content]").innerHTML = content;
    backdrop.querySelector("[data-modal-close]").addEventListener("click", close);
    const actionRoot = backdrop.querySelector("[data-modal-actions]");
    for (const action of actions) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => action.onClick?.({ close, element: backdrop }));
      actionRoot.append(button);
    }
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
    backdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...backdrop.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")]
        .filter((item) => !item.disabled && item.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    documentRef.body.append(backdrop);
    documentRef.body.classList.add("samt-modal-open");
    active = backdrop;
    backdrop.querySelector("button, input, select, textarea")?.focus?.();
    return { close, element: backdrop };
  }

  return { open, close, isOpen: () => Boolean(active) };
}
