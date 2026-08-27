# SAMT architecture

SAMT keeps the working Version 2 reference client and adds a replaceable V3
engine beside it. `index.html` remains a single portable shell; it boots the
embedded client first, then loads `js/main.js` when served from a folder. If
the module bridge is unavailable, the Version 2 client still works.

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
- **UI** (`js/ui` plus the embedded reference client) renders state and sends
  commands. The V3 panel is a small progressive-disclosure engine inspector,
  not a second application.

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

The reference client retains the existing V2 key
`life-command-progress-tracker-v2`. The V3 adapter reads a V3 key first and
otherwise normalises V2/V1 data into a separate V3 state while preserving
stable IDs, logs, snapshots and the complete source state in `legacy`.
Writes are best effort. A blocked or unavailable storage implementation never
prevents startup; it simply keeps the current state in memory. Imports return a
restore point and are validated before replacement.

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
