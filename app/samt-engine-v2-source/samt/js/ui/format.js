export function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function titleCase(value) { return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

export function formatDateTime(value, compact = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, compact ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatMetric(value, metric) {
  if (metric === "time") {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`;
  }
  return Number(value || 0).toLocaleString();
}

export function badge(status) {
  const kind = ["completed", "success", "target_reached", "over_target"].includes(status) ? "success" : ["failed", "missed", "overdue"].includes(status) ? "danger" : ["due", "partial", "neutral"].includes(status) ? "warning" : "";
  return `<span class="badge ${kind ? `badge-${kind}` : ""}">${escapeHtml(titleCase(status))}</span>`;
}
