# SAMT — Life Command Tracker V3

This repository contains the V3 application: a simple modular client over a
tested, UI-independent domain/application engine. The previous portable
Version 2 client is retained as `life-command-tracker-v2-standalone.html` only
for compatibility and migration recovery; it is not the V3 interface.

Open the repository root `index.html` from a local server. It needs no JSON
file and creates a valid empty V3 state. If browser storage is blocked, it
continues safely in memory and explains that state in Settings.

On a clean V3 install the engine state is genuinely empty (built-in Units are
available immediately). When a V2/V1 record is found, the adapter writes an
exact restore point before committing a validated V3 copy; the original V2/V1
key is never overwritten. If that commit is blocked, the migrated state stays
usable in memory and startup still succeeds.

The V3 shell exposes the engine through Home, Actions, Blocks, Cycles, To-do,
Projects, Reviews, Analysis, History, Capacity and Settings. Blocks use
separate Open and Edit routes. Quick logging creates one factual Action Log,
while the engine resolves contextual attribution and target progress.

CSS lives in `styles/`; reusable fragments live in `html/templates/`. The
legacy standalone file remains untouched so old data can always be opened or
exported if needed.

Run the offline regression suite with:

```sh
node --test tests/*.test.js
```

See [ARCHITECTURE.md](ARCHITECTURE.md), [DOMAIN_RULES.md](DOMAIN_RULES.md) and
[FEATURE_PARITY.md](FEATURE_PARITY.md) for the boundaries and locked rules.
