# Feature parity inventory

The existing Version 2 reference client remains intact in `index.html` and
`life-command-tracker-v2-standalone.html`. V3 is additive: its engine bridge
does not replace the working client.

| Feature | Status | Notes |
| --- | --- | --- |
| Dashboard | EXISTING + EXPANDED | Existing Dashboard remains visible; `getHomeViewModel()` supplies a replaceable read model. |
| Actions | EXISTING + EXPANDED | Existing builder/logging stays; V3 adds completion and one-to-ten Result Fields. |
| Cycles | EXISTING + EXPANDED | Existing cycle UI stays; deterministic exact/weighted Small/Big Cycle domain rules are available. |
| To-do | EXISTING | Existing V2 task screens remain unchanged. |
| Projects | EXISTING + EXPANDED | Existing builder stays; V3 condition/dependency/milestone engine is additive. |
| Reviews | EXISTING | Existing V2 review screen remains. |
| Analysis | EXISTING + EXPANDED | Existing analysis remains; V3 distinguishes GLOBAL_UNIQUE and inclusive attributed queries. |
| History | EXISTING + EXPANDED | Existing factual ledger remains; V3 snapshots and lifecycle records are supported. |
| Capacity | EXISTING | Existing capacity settings remain. |
| Settings | EXISTING + EXPANDED | Existing Backup/Build/Capacity remain; V3 engine inspector adds export/reconciliation. |
| Build functionality | EXISTING + EXPANDED | Existing Category/Action/Block/Cycle/Project builders remain; taxonomy, Units and Result Field APIs are additive. |
| Import/export | EXISTING + EXPANDED | V2 import/export remains; schema-v3 package validator/exporter/importer adds atomic restore-point flow. |
| Persistence | EXISTING + EXPANDED | V2 key is retained; V3 uses a separate key and safe in-memory fallback. |
| Startup | EXISTING + EXPANDED | Built-in V2 starter state opens without JSON; blocked storage cannot stop startup. |
| Navigation | EXISTING | All nine V2 screens remain. |
| Domain engine | NEW | Pure Actions, Results, Units, taxonomy, relationships, Blocks, scheduling, Runs, Occurrences, Targets, Avoid, Cycles and lifecycle modules. |

No current feature was removed because a V3 rule was not yet connected to the
reference UI. The engine is deliberately introduced beside the working
client, leaving room for future screen-by-screen replacement after parity QA.
