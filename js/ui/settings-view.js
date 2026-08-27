export function renderSettingsView(model = {}) { return `<section aria-labelledby="settings-title"><h1 id="settings-title">Settings</h1><p>Timezone: ${escapeText(model.timezone || "UTC")}</p></section>`; }
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
