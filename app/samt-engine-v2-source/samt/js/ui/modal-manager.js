import { escapeHtml } from "./format.js";

function focusable(container) {
  return [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]')].filter((element) => !element.hidden);
}

export function modalMarkup({ title, body, submitLabel = null, cancelLabel = "Cancel", destructive = false, dismissible = true, wide = false }) {
  const headerClose = dismissible && submitLabel
    ? '<button type="button" class="btn btn-ghost btn-small" data-modal-close aria-label="Close dialog">Close</button>'
    : "";
  return `<section class="modal-dialog ${wide ? "modal-dialog-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="global-modal-title" tabindex="-1"><form data-modal-form><div class="modal-head"><div><h2 id="global-modal-title">${escapeHtml(title)}</h2></div>${headerClose}</div><div class="stack" data-modal-body>${body}</div><div class="modal-actions"><button type="button" class="btn btn-ghost" data-modal-close>${escapeHtml(cancelLabel)}</button>${submitLabel ? `<button type="submit" class="btn ${destructive ? "btn-danger" : "btn-primary"}">${escapeHtml(submitLabel)}</button>` : ""}</div></form></section>`;
}

export class ModalManager {
  constructor(root) { this.root = root; this.active = null; this.opener = null; this.keyHandler = null; }

  close(result = null) {
    if (!this.active) return;
    const { resolve } = this.active;
    document.removeEventListener("keydown", this.keyHandler, true);
    document.body.classList.remove("modal-open");
    this.root.replaceChildren();
    this.active = null;
    const opener = this.opener;
    this.opener = null;
    if (opener && opener.isConnected) opener.focus();
    resolve(result);
  }

  open({ title, body, submitLabel = null, cancelLabel = "Cancel", destructive = false, dismissible = true, wide = false }) {
    if (this.active) this.close(null);
    this.opener = document.activeElement;
    document.body.classList.add("modal-open");
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = modalMarkup({ title, body, submitLabel, cancelLabel, destructive, dismissible, wide });
      this.root.replaceChildren(backdrop);
      this.active = { resolve, backdrop };
      backdrop.addEventListener("click", (event) => {
        if (event.target.matches("[data-modal-close]") || (dismissible && event.target === backdrop)) this.close(null);
        if (event.target.closest("[data-close-modal]")) this.close({ navigation: true });
      });
      backdrop.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        this.close(new FormData(event.currentTarget));
      });
      this.keyHandler = (event) => {
        if (event.key === "Escape" && dismissible) { event.preventDefault(); this.close(null); return; }
        if (event.key !== "Tab") return;
        const elements = focusable(backdrop);
        if (!elements.length) return;
        const first = elements[0]; const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      document.addEventListener("keydown", this.keyHandler, true);
      queueMicrotask(() => (focusable(backdrop)[0] || backdrop.querySelector(".modal-dialog")).focus());
    });
  }

  async confirm({ title, message, confirmLabel = "Confirm", destructive = false }) {
    const value = await this.open({ title, body: `<p>${escapeHtml(message)}</p>`, submitLabel: confirmLabel, destructive });
    return Boolean(value);
  }
}
