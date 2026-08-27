# SAMT architecture

SAMT V3 is the primary application on the repository root. `index.html` is a
small shell that loads the modular V3 client from `js/main.js`; it contains no
embedded business engine or duplicate screen application. The former Version
2 client is retained only as `life-command-tracker-v2-standalone.html` so old
records can still be opened/exported during migration and recovery.

## Layers

- **Domain** (`js/domain`, `js/shared`) contains serialisable rules only. It
  receives `now`, timezone, definitions and factual records as arguments. It
  never imports the DOM, browser storage, network APIs or UI code.
- **Application** (`js/application`) exposes commands, selectors, queries,
  home/analysis read models and explicit temporal reconciliation. Commands
  perform atomic repository transactions and emit lightweight events.
- **Infrastructure** (`js/infrastructure`) implements repository, local
  storage, IndexedDB boundary, backup and testable clocks. Browser storage is
  optional; the repository remains usable in memory when it is blocked.
- **UI** (`js/ui`) renders V3 view models and sends commands. It contains
  progressive-disclosure editors for the seven Block types, Actions/Results,
  taxonomy, Units, scheduling and runtime records, but it does not implement
  SAMT formulas.

The direction is UI → application → domain. Infrastructure is injected at the
application boundary. A future Next.js, desktop or mobile client can import
the domain/application modules and replace only the UI and repository.

## Runtime vocabulary

Definitions are permanent reusable configuration. Relationships contextualise
an Action or Block. Activations say when a definition is in use. Runs are
finite executions. Occurrences are generated scheduled instances. Periods are
bounded evaluation windows. Cycles additionally keep persistent Position and
freeze generated Small/Big Cycle snapshots.

## Data flow

User interaction becomes a command. The application validates it with domain
functions, writes factual data in one repository transaction, appends a
history/event record, then queries a view model. Home and Analysis never
recalculate business rules in the DOM.

## Storage and migration

The V3 adapter reads the V3 key first and otherwise normalises the existing
V2/V1 keys into a separate V3 state while preserving stable IDs, logs,
snapshots and the complete source state in `legacy`. Before the first V3 write
it stores the exact source payload in a restore-point key, validates the
migrated state, then commits the V3 copy. The source V2/V1 key is never
overwritten. A blocked or unavailable storage implementation never prevents
startup; it simply keeps the current state in memory. Imports return a restore
point and are validated before replacement. A clean install creates a valid
empty state and never waits for JSON.

## Time

Production time comes from `systemClock`; tests use `fakeClock`. Domain period
and schedule functions require an explicit timezone and week start. Calendar
period boundaries are calculated in local time, so DST does not turn a local
day into an assumed UTC day.

## History and attribution

An actual user event creates one Action Log. Context references can connect it
to several Blocks, Runs or Occurrences. Global and inclusive calculations call
`aggregateLogsUnique`, so an attributed log is never multiplied merely because
it appears in several contexts. Action Logs, result snapshots, generated cycle
sequences, period evaluations and lifecycle changes are factual history.
