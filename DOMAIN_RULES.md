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
