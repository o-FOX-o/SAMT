# SAMT — Life Command Tracker V2 + V3 Engine

This repository keeps the working Version 2 reference application and adds a
tested, UI-independent V3 domain/application engine.

Open `index.html` from a local server for the reference client. It needs no
JSON file and creates a valid starter state. If browser storage is blocked, it
continues in memory. The portable `life-command-tracker-v2-standalone.html`
also works by itself.

The optional V3 bridge loads local ES modules when `index.html` is served from
the repository. It exposes `globalThis.SAMT_ENGINE` and a small **SAMT Engine
V3** inspector at the bottom of the page. The embedded V2 screens remain the
visible product while the domain/application modules are prepared for future
web, desktop, Android and iOS clients.

Run the offline regression suite with:

```sh
node --test tests/*.test.js
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [DOMAIN_RULES.md](DOMAIN_RULES.md) and
[FEATURE_PARITY.md](FEATURE_PARITY.md) for the boundaries and locked rules.
