export function renderHomeView(model = {}) { return `<section aria-labelledby="home-title"><h1 id="home-title">Home</h1><p>${escapeText(model.now?.choice?.type || "No current choice")}</p></section>`; }
const escapeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
