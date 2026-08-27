# Feature parity inventory

The V3 client is the visible application in `index.html`. The former Version
2 client remains intact only in `life-command-tracker-v2-standalone.html` as a
compatibility and recovery artifact; it is not mounted by the V3 shell.

| Feature | Status | Notes |
| --- | --- | --- |
| Dashboard | MIGRATED + EXPANDED | V3 Home is driven by `getHomeViewModel()` and exposes Now, Due, Avoid, Today, This week, Project and Upcoming. |
| Actions | MIGRATED + EXPANDED | V3 list/detail/edit/logging supports completion and 0–10 Result Fields. |
| Cycles | MIGRATED + EXPANDED | V3 page exposes current position, generated sequence, advancement and Small Cycle generation; deterministic exact/weighted Big Cycle rules live in the engine. |
| To-do | MIGRATED | V3 To-do view reads migrated tasks, quick tasks and Action List occurrences. |
| Projects | MIGRATED + EXPANDED | V3 project view supports Run Now, primary selection and condition/dependency/milestone engine data. |
| Reviews | MIGRATED | V3 review list/create/complete view uses the migrated review records. |
| Analysis | MIGRATED + EXPANDED | V3 filters factual logs and distinguishes GLOBAL UNIQUE from attributed/inclusive totals and target/result analysis. |
| History | MIGRATED + EXPANDED | V3 renders the chronological factual ledger, snapshots and lifecycle records. |
| Capacity | MIGRATED | V3 capacity view reads the preserved capacity settings and factual time. |
| Settings | MIGRATED + EXPANDED | V3 exposes timezone, week start, capacity, defaults, taxonomy, Units and data restore/import/export. |
| Build functionality | MIGRATED + EXPANDED | V3 builders cover Categories, Tags, Units, Actions, Result Fields, Blocks and contextual relationships. |
| Import/export | MIGRATED + EXPANDED | Schema-v2 packages remain compatible; schema-v3 packages use canonical validation and atomic restore points. |
| Persistence | MIGRATED + EXPANDED | V2/V1 keys are read without overwrite; V3 uses a separate key and safe in-memory fallback. |
| Startup | MIGRATED + EXPANDED | V3 opens with a genuinely empty state when no data exists; JSON is never required and blocked storage is non-fatal. |
| Navigation | MIGRATED + EXPANDED | V3 exposes Home, Actions, Blocks, Cycles, To-do, Projects, Reviews, Analysis, History, Capacity and Settings through one router. |
| Domain engine | MIGRATED + EXPANDED | Pure Actions, Results, Units, taxonomy, relationships, Blocks, scheduling, Runs, Occurrences, Targets, Avoid, Cycles, lifecycle, analysis and migration modules. |

No current feature was removed because a V3 rule was not yet connected to the
UI. The V2 standalone artifact is kept for compatibility, while the root
application now uses the V3 UI and engine as the single visible source of
truth.
