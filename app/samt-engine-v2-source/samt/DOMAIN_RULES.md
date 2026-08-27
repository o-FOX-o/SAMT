# Locked SAMT domain rules

## Identity and history

1. Stable IDs are identity; names are editable labels.
2. One real event creates one Action Log.
3. A log may be attributed to many eligible contexts, but global totals count
   its ID once.
4. History stores factual logs and necessary lifecycle evaluations. Analysis is
   a query, not a second truth database.
5. Historical records retain name/configuration snapshots where interpretation
   could otherwise change.
6. A factual event time and the time it was recorded are separate. Period
   attribution uses the factual event time.
7. Updating or deleting a log is a correction: affected runtime totals are
   recalculated and History retains the prior factual snapshot.
8. Names are Unicode labels, not identity. Normalisation preserves multilingual
   text and stable IDs never change when labels change.

## Definitions and execution

1. Block definition, Activation, Run, Occurrence and Period are separate.
2. `active` means participating in the live system; it does not mean running.
3. `running` requires a current Run.
4. `due` belongs to a positive occurrence requiring attention.
5. Open and Edit are separate operations and routes.
6. Collections organise children and do not create fake progress.
7. Action Lists are ongoing pools; their child relationships generate
   Occurrences, not daily list Runs.

## Block graph

1. A Block may reference Actions and Blocks by stable ID.
2. Circular Block paths are invalid.
3. A Block ID appears at most once in one root tree.
4. A Block may be reused in another independent root tree.
5. An Action appears at most once directly in one Block, but may appear in
   different Blocks.

## Targets

1. Time, Quantity and Completion Count are supported.
2. Periods are Session, Day, Week, Month, Custom and All Time.
3. Inclusive aggregation recursively gathers descendant Action Logs and
   deduplicates by log ID.
4. Direct and inclusive totals remain distinguishable.
5. Actual performance is never capped. `22 / 18` remains 122.22% and +4.
6. Parent and child Targets are independent unless required child Targets are
   explicitly enabled.
7. Closing a period saves an evaluation; it never deletes its logs.
8. An open period keeps its Target definition and descendant Action scope
   snapshot. Definition edits take effect in the next period.

## Avoid

1. Avoid activity is logged as a positive factual amount, never a negative log.
2. Avoid evaluation is contextual and supports Binary Limit, Scored Range and
   Violation Multiplier.
3. Scored Range uses piecewise-linear interpolation between explicit anchors.
4. Scores may exceed 100% or fall below 0%.
5. Failure Load is not a Success Score and is not capped.
6. A zero-activity successful period saves a period evaluation, not a fake zero
   Action Log.
7. Early irreversible failure may be shown immediately, but the period keeps
   collecting factual activity until it closes.
8. Avoid status never subtracts time from positive Productivity unless a future
   explicit formula says so.

## Cycles

1. A Cycle answers what comes next; it is not primarily a target.
2. Frequency is contextual to the parent relationship and generates a smooth,
   deterministic weighted sequence without structural duplication.
3. Period reset and sequence-position reset are different operations.
4. Default period-end position policy is Continue.
5. Default missed-item policy is Keep Position; Skip and Restart are explicit.
6. Cycle period close records whether the current item was completed, then
   applies missed-item and position policies as two separate decisions.

## Scheduling and time

1. Time is injected into domain/application services.
2. Calendar boundaries use an explicit timezone and configured week start.
3. Recurring reconciliation is deterministic and idempotent.
4. Reconciliation catches up every elapsed local-calendar window after an
   offline gap. Stable temporal IDs prevent duplicate periods and Occurrences.
5. Daily expired prayer/nutrition-style occurrences become missed when their
   relationship is configured to expire; they do not carry into the next day.
6. Friday-only schedules generate no Thursday or Saturday occurrence.

## Data safety and packages

1. Fresh state is empty; migration never deletes existing data.
2. Existing storage names and stable IDs are preserved.
3. Migration reads and validates the legacy shape, saves an immutable
   version-keyed raw backup, migrates in memory, validates, then commits
   atomically. Failure leaves the old state untouched.
4. Package schema version 2 remains canonical; version 1 packages migrate to 2.
5. Reusable packages never replace factual History. Full Backup is the only
   complete-state transport.
6. Import validates references and the complete remapped graph before one
   transaction commits it.
7. Import commit rebuilds from the validated package instead of trusting a
   mutable preview candidate. Undo Import restores the exact pre-import state.
