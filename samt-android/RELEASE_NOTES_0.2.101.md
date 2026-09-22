# SAMT Android 0.2.101 — Plan Everything stabilization

This release candidate finishes the remaining Plan Everything repair pass on
the Android V3 client without changing the SAMT storage key or replacing the
existing application.

## Runtime fixes

- Blank Action List deadlines remain open instead of expiring at due time.
- Editing, pausing, off-periods, timezone changes and archive operations
  supersede obsolete future occurrences so old alarms do not linger.
- Archive is administrative cancellation, not a fabricated failure.
- Weekly parent Routines only expect nested daily Runs from the nested
  Routine's actual activation date.
- Paused Targets exclude paused time and do not manufacture missed periods.
- Explicit Missed Action logs remain factual history but do not count as
  successful Target progress.
- Calendar Routine pause/resume does not duplicate same-period Runs.
- Block type is immutable after creation.
- Relationship-specific completion rules allow one Action to require different
  quantities or time in different Blocks.

## Results and Targets

- Numeric Results can use explicit allowed values.
- A Result can mark zero as a Missed Action in the UI.
- Result Targets can sum multiple selected numeric Result fields while
  deduplicating the underlying factual Action Log.

## Android

- System Back dismisses modals, returns from Block detail, then returns to Today.
- Alarm settings expose notification/exact-alarm health, scheduled count,
  next alarm and upcoming reminders.
- A ten-second test alarm is available from Settings.
- Project alarms remain scheduled while Projects are in persistent live states.

## Verification

GitHub Actions runs the domain regression suite, mobile UI smoke test and signed
release APK build. Physical-device alarm delivery is still a real-phone check
because Android permissions and manufacturer battery controls are outside CI.
