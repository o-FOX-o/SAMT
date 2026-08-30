# Feature parity inventory

The V3 client is the visible application in `index.html`. The former Version
2 client remains intact only in `life-command-tracker-v2-standalone.html` as a
compatibility and recovery artifact; it is not mounted by the V3 shell.

A feature is marked complete only when its domain rules exist, the V3 UI
exposes the operation, the command/runtime path is wired to the same engine,
and the relevant regression coverage passes. “Tested” below refers to the
Node domain/application/integration suite and the available render/command
smoke checks; it is not a claim that a separate browser automation runner
exists.

| Feature | Domain implemented | UI implemented | Runtime wired | Tested |
| --- | --- | --- | --- | --- |
| Dashboard / Home | Yes | Yes | Yes | Yes — Home read-model regressions |
| Actions and Results | Yes | Yes | Yes | Yes — completion, Result validation and analysis tests |
| Collections | Yes | Yes | Yes | Yes — graph and runtime-boundary tests |
| Action Lists | Yes | Yes | Yes | Yes — schedule, anchor, overlap and Activation tests |
| Routines | Yes | Yes | Yes | Yes — fresh Runs, aggregation, qualification and finish tests |
| Workflows | Yes | Yes | Yes | Yes — ordered steps, blocking, deadlines and Return tests |
| Projects | Yes | Yes | Yes | Yes — conditions, milestones, dependencies and scope tests |
| Cycles | Yes | Yes | Yes | Yes — generated exact/weighted slots and Big Cycle coverage tests |
| Targets | Yes | Yes | Yes | Yes — outcome/measurement, child requirements and period tests |
| Avoid Actions | Yes | Yes | Yes | Yes — binary, scored and multiplier tests |
| To-do / Reviews | Yes | Yes | Yes | Yes — preserved command/storage coverage |
| Analysis | Yes | Yes | Yes | Yes — attribution, Result and compatible-Unit analysis tests |
| History | Yes | Yes | Yes | Yes — snapshots/tombstones and deletion-integrity tests |
| Capacity | Yes | Yes | Yes | Yes — settings persistence coverage |
| Settings | Yes | Yes | Yes | Yes — Settings render and management-command coverage |
| Build functionality | Yes | Yes | Yes | Yes — taxonomy, Unit, Action and Block command coverage |
| Import / Export | Yes | Yes | Yes | Yes — canonical package validation, preview, atomic import and undo |
| Data Manager / Bin | Yes | Yes | Yes | Yes — indexed filters, dependency preview, stable-ID restore and runtime deletion |
| Persistence / Migration | Yes | Yes | Yes | Yes — V2 compatibility, blocked storage and empty-state tests |
| Navigation / V3 shell | Yes | Yes | Yes | Yes — route/render smoke coverage |

The V3 Settings surface is separated into General, Capacity, Defaults, Build,
Import / Export, Data & Storage, Bin / Recently Deleted and App. It uses the
canonical exporter/importer, exact runtime-record selection for semantically
valid cleanup, dependency-aware definition operations, restore points and a
valid empty-state reset.

No current feature was removed because a V3 rule was not yet connected to the
UI. The V2 standalone artifact is kept for compatibility, while the root
application uses the V3 UI and engine as the single visible source of truth.
