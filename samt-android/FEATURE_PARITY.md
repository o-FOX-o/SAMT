# SAMT Android — feature contract

The September 2026 V3 discussions are the source of the domain rules. The earlier
SAMT HTML is a reference for expected behaviour only. This is a new phone UI and
an independent engine. A feature is complete only after it works in the UI,
survives app restart, appears in backup/import and has a relevant test.

## Identity, data and safety

- Stable IDs for Category, Tag, Unit, Action, Result, Block, Relationship,
  Activation, Run, Occurrence, Period, Cycle position, Log and History event.
- Definition, relationship, activation and runtime are different objects.
  Existing Runs carry immutable snapshots; editing a definition affects future
  Runs only. OPEN is separate from EDIT.
- One real Action event creates one factual Action Log, attributed by context to
  any number of Blocks; global time and quantity are counted only once.
- Empty state works. JSON backups include all definitions, runtime, positions,
  logs, reviews, settings, history and Bin. Import is validated and atomic.
  Archive, Move to Bin, Restore and Permanent Delete have different meanings;
  deletion preserves factual history and checks dependencies. Restore points
  and selective data deletion are explicit.

## Builders and domain

- Categories, one-category Tags and compatible Units.
- Actions with Do/Avoid direction, quantity/time completion and 0–10
  independently validated Results (percentage, score, measurement, text,
  choice); value and definition snapshots stay with historical Logs.
- Exactly seven Block types: Collection, Action List, Routine, Workflow,
  Project, Cycle and Target. Children reference Actions or Blocks by ID; cycles
  in the relationship graph are rejected.
- Action List is continuous and has no Run. Stable Action/Todo Entries produce
  Occurrences. Todo Done produces no Action Log. Each Entry records when it was
  added and edited.
- Shared time/scheduling/notification engines: manual, once, daily, weekly,
  monthly, yearly, interval, specific dates; start/end windows, availability,
  deadlines, unfinished/overlap policy and repeat end. Off Period, Skip, Pause
  and Archive are distinct. Off Periods may end by date or by notification;
  overlapping Off Periods are rejected. Multiple reminders, optional alarm,
  snooze and permission status belong to the same engine across Blocks.
- Routine creates fresh calendar Runs. Daily and weekly runs close at their
  Europe/London boundary, save unfinished required work as MISSED and start the
  next Run automatically. Prayer and hygiene are user-created data, not
  hard-coded. Dhuhr can be required while Jumu'ah remains optional.
- Workflow has persistent ordered/returnable steps; Project has persistent
  outcome/requirements and milestones. Neither resets at midnight.
- Cycle generates deterministic Small/Big Cycles, keeps its current position
  across missed days by default and advances only through the configured
  resolution. Weighted participants and explicit skip policies are supported.
- Target tracks independent period goals (count, time, quantity or compatible
  Result); historical evaluations include actual value, target and uncapped
  overachievement. Avoid is evaluated from factual violations, including
  successful zero-violation periods, without inventing negative Action Logs.

## Screens and Android

- New colour-based phone interface: Today, Actions/Build, Blocks, Log,
  Reviews, Analysis, History, Capacity and Settings/Data Manager.
- System, Light and Dark themes; semantic and user-editable accent colours.
- Home surfaces Now, Due, Avoid, Today, Week, Project and Upcoming without
  mutating runtime just because it rendered.
- Android notifications and exact alarms work when the app is closed (subject
  to granted device permissions). Recover schedules after reboot, time change,
  timezone change and permission changes. Display permission status clearly.
- Local-first; no login or internet connection needed. A signed APK and full
  buildable source are the deliverables.

## Acceptance scenarios

1. Log an Action from two contexts: one Log ID and one global duration.
2. Edit an Action/Block after a Run starts: old Run and Log keep snapshots.
3. Close a daily Routine at London midnight, including a DST transition:
   required undone work is MISSED and the next Run starts once.
4. Close a weekly Routine at the configured week start; preserve History.
5. Complete a Todo occurrence without creating an Action Log; log an Action
   occurrence exactly once.
6. Off prevents occurrence generation; Skip resolves one occurrence; Pause
   suppresses future scheduling; Archive changes the definition status.
7. A missed Cycle item retains position; a successful item advances it.
8. An Avoid target with zero violations can succeed without an Action Log.
9. Backup/import round trip retains positions, Runs, Occurrences, Logs,
   Results, Bin, settings and theme; invalid import changes nothing.
10. Alarm/notification fires with the app closed and is rescheduled on reboot.


## 0.2.101 verification notes

The automated contract now includes regression coverage for blank deadlines,
timezone regeneration, archive cancellation, nested Routine activation,
same-day pause/resume, paused Target intervals, explicit Missed logs, discrete
Result values, multi-Result Target totals, relationship completion overrides,
Project conditions/scope and data safety.

The Android client also exposes alarm permission state, scheduled-alarm count,
next alarm, upcoming reminders and a ten-second test alarm. Closed-app
notification delivery remains a physical-device acceptance check rather than a
CI assertion.
