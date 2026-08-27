# SAMT — Life Command Tracker V2 + V3 Engine

This repository keeps the working Version 2 reference application and adds a
tested, UI-independent V3 domain/application engine.

Open `index.html` from a local server for the reference client. It needs no
JSON file and creates a valid V2 starter state. If browser storage is blocked,
it continues in memory. The portable `life-command-tracker-v2-standalone.html`
also works by itself.

On a clean V3 install the engine state is genuinely empty (built-in Units are
available immediately). When a V2/V1 record is found, the adapter writes an
exact restore point before committing a validated V3 copy; the original V2/V1
key is never overwritten. If that commit is blocked, the migrated state stays
usable in memory and startup still succeeds.

The optional V3 bridge loads local ES modules when `index.html` is served from
the repository. It exposes `globalThis.SAMT_ENGINE` and a small **SAMT Engine
V3** inspector at the bottom of the page. The embedded V2 screens remain the
visible product while the domain/application modules are prepared for future
web, desktop, Android and iOS clients.

Namespaced CSS lives in `styles/`; reusable fragments live in `html/templates/`.
They are additive and do not replace the embedded portable styling.

Run the offline regression suite with:

```sh
node --test tests/*.test.js
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [DOMAIN_RULES.md](DOMAIN_RULES.md) and
[FEATURE_PARITY.md](FEATURE_PARITY.md) for the boundaries and locked rules.
