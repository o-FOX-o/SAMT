export function createRouter({ windowRef = globalThis.window, onRoute = () => {} } = {}) {
  function current() { const raw = windowRef?.location?.hash?.replace(/^#/, "") || "/"; return raw.startsWith("/") ? raw : `/${raw}`; }
  function navigate(path) { if (!windowRef) return; windowRef.location.hash = path.startsWith("#") ? path.slice(1) : path; onRoute(current()); }
  function start() { const handler = () => onRoute(current()); windowRef?.addEventListener?.("hashchange", handler); handler(); return () => windowRef?.removeEventListener?.("hashchange", handler); }
  return { current, navigate, start };
}
