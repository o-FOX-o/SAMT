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
