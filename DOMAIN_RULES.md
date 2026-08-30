# SAMT locked domain rules

- Stable IDs are identity; names are labels. Renaming never rewrites links.
- A real-world event is exactly one factual Action Log, even when it satisfies
  multiple contexts.
- Action definitions describe what happened. Schedule, deadline, recurrence,
  required state and frequency live on relationships/runtime objects.
- An Action may have zero to ten Result Fields. Result type does not determine
  completion; required Result Fields are validated separately when a log is
  finalised.
- Quantity actuals and time actuals are never capped at their target.
- Result values keep field ID/version and snapshots of labels, units, options
  and score maxima. Editing a definition cannot rewrite old History.
- Categories contain Tags. A Tag belongs to one Category and cannot have a
  broader scope. Used taxonomy is archived, not destroyed.
- Units convert only inside compatible dimensions. Standalone units such as
  pages, reps and kcal do not become compatible by name.
- Avoid Actions remain factual positive usage. Limits and scores are derived;
  zero-usage success never creates a fake zero log.
- Collections organise and browse. They do not have Runs, deadlines,
  completion percentages or periods.
- Action Lists are open-ended pools. Each relationship can generate its own
  Occurrences; Skip, Missed, Deferred and Excused remain different meanings.
- Routines create fresh Runs. Required children remain required even when a
  count/percentage threshold has been met.
- Workflows are ordered persistent processes. A day boundary does not reset a
  Workflow; Return To Step is an explicit historical transition.
- Projects retain progress after a soft deadline. Hard expiry is explicit.
- Cycles retain Position across period closure. Weighted scheduling is
  deterministic and persistent; Small Cycle appearance coverage is separate
  from completion coverage, and Big Cycle coverage cannot deadlock on a skip.
- Targets distinguish accumulation (SUM/COUNT) from outcomes (latest,
  highest, lowest or average). Calendar and rolling periods are different.
  Inclusive contribution is always unique by Action Log ID. Parent and child
  Targets are independent unless a child requirement is explicitly selected.
- Temporal reconciliation is explicit and idempotent. Rendering does not
  silently mutate storage.
- JSON is optional at startup. Storage errors are recoverable and never fatal.

## Settings and data-management rules

- Settings is an operational surface over the existing V3 engine. General
  timezone and week-start settings affect future scheduling/calendar
  calculations; changing them never rewrites stored timestamps. Capacity is
  planning information, not an XP, punishment, streak or productivity score.
- Archive, Move to Bin and Permanent Delete are distinct operations. Archive
  keeps the definition, stable ID, references and History while removing it
  from active use; unarchiving restores its prior active/library status where
  possible. Normal Delete means Move to Bin, never immediate destruction.
- A Bin entry keeps the stable object ID, type, deletion time, prior status,
  definition snapshot and dependency metadata. Restoring a Bin entry reuses
  the same ID. Missing dependencies are reported and may only be restored
  together when they are deterministic and available in the Bin.
- Permanent Delete is dependency-aware and destructive. Live references and
  historical usage are calculated before commit. Collections do not own their
  child Blocks or Actions; deleting a Collection never cascades into those
  definitions. Category, Tag and Unit dependencies require explicit handling
  and never silently delete dependent definitions.
- Deleting a definition never rewrites factual History. Action Logs, Runs,
  Occurrences, Target evaluations and analysis retain the snapshots or
  tombstones required to remain readable after a live definition, Result
  Field, Tag or Unit is removed. A factual event remains one factual event.
- Data Manager search and filters operate on a derived index rather than
  repeatedly scanning serialized backup blobs. Bulk management builds and
  validates a candidate state, creates a restore point when required and
  commits once; a failed validation leaves the current state unchanged.
- Clear Data is selective and filterable. It removes only the explicitly
  selected supported runtime/data categories and previews effects on Targets,
  Occurrence completion, Analysis and History. History records are retained
  unless explicitly selected. Clear Everything / Start Fresh is a danger-zone
  operation that creates a restore point, exports a backup option, then
  returns the engine to a valid empty V3 state with built-in Units only and no
  starter/demo content.
- Restore points are factual state snapshots created before imports and major
  destructive Settings operations. Import history records committed imports;
  Undo Last Import restores the state captured immediately before the latest
  import when that restore point is available.

## Runtime boundaries and lifecycle

- Definitions, Relationships, Activations, Occurrences, Runs, Periods and
  Positions are separate records with separate responsibilities. A
  Definition is reusable configuration; a Relationship is a contextual
  connection; an Activation is the execution/scheduling gate; an Occurrence
  is a scheduled opportunity; a Run is a finite execution instance; a Period
  is an evaluation window; and a Position is a persistent ordered-runtime
  pointer.
- Definition status (`LIBRARY`, `ACTIVE`, `PAUSED`, `ARCHIVED`) does not
  itself create daily runtime. New Runs and scheduled Action List Occurrences
  are generated only through explicit, idempotent reconciliation and the
  applicable Activation/schedule.
- Action List relationships may create independent Occurrences. Routine,
  Workflow, Project and Cycle children are owned by their type-specific Run or
  generated slot runtime and are not turned into unrelated generic recurring
  Occurrences. Existing legacy generic child Occurrences are retained and
  marked with their legacy runtime boundary so migration does not erase data.
- Routine Runs start with a fresh child snapshot and may become
  `READY_TO_FINISH` before the user explicitly finishes. Workflow and Project
  Runs retain ordered/outcome progress across date boundaries, while Cycle
  Runs resolve generated Small Cycle slots and retain their Position and
  Small/Big Cycle coverage.
- Cycle appearance/resolution coverage and completion coverage are independent.
  Completed and permitted skipped slots count as appeared/resolved; deferred
  or unavailable slots return to the current generated position and do not
  falsely count as appeared.

## Deletion, recovery and historical integrity

- Archive, Move to Bin and Permanent Delete are distinct. Archive keeps the
  live definition, stable ID, references and History but removes it from active
  use. Normal Delete means Move to Bin. Permanent Delete is the only
  destructive definition operation.
- Definition deletion is dependency-aware and atomic. The impact is calculated
  before commit; Collections do not own their children; Category, Tag and Unit
  dependents are not silently cascaded; and a failed validation leaves the
  prior state unchanged.
- Bin entries retain the stable ID, type, deletion time, prior status,
  definition snapshot and dependency metadata. Restore reuses the same ID and
  reports missing dependencies. Runtime records such as Action Logs, Runs and
  Occurrences are not placed in the definition Bin; they can be explicitly
  selected for semantically valid permanent deletion from Data Manager.
- Permanent deletion and Clear Data may remove explicitly selected factual
  runtime records only after an impact preview and restore point. Removing an
  Action Log also detaches its runtime references and recalculates derived
  completion without rewriting retained snapshots.
- Historical Action Logs, Result Values, closed Period evaluations, completed
  Runs, resolved Cycle slots and scope-change events remain readable through
  snapshots/tombstones after live definitions, Result Fields, Tags or Units
  are archived or deleted. One factual event remains one Action Log.
- Full-state replacement imports, bulk permanent deletes, Empty Bin and
  Clear Everything create restore points where possible and commit only after
  candidate-state validation. Clear Everything boots a valid empty V3 state
  with built-in Units and no demo content; it does not require JSON at startup.
