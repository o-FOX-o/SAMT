# SAMT Android — stabilization + visual-system candidate

This is the Android V3 client for SAMT. The domain engine is UI-independent in
`web/engine.js`; the phone interface runs locally in Android's WebView and uses
a native bridge for alarms, calendar rollover, backups and phone permissions.
There is no login, server or internet permission.

**Status:** the Plan Everything stabilization pass and the first full visual
system pass are implemented and covered by the automated engine/UI/build
pipeline. Read [FEATURE_PARITY.md](FEATURE_PARITY.md) for the domain contract
and [VISUAL_SYSTEM.md](VISUAL_SYSTEM.md) for the visual contract. Real-phone
notification delivery still needs a physical-device check because Android
permission and battery behavior cannot be proven in CI.

## Visual system

SAMT no longer treats a theme as one indivisible skin. Four independent axes can
be mixed:

- **Layout:** Simple, Orbit, Command, Journal or Matrix.
- **Appearance:** Follow phone, Light, Dark or Neon.
- **Colour:** a built-in palette, custom colours, and optional user-selected
  Category colours. No life domain is assigned a compulsory semantic colour.
- **Writing style:** Clean, Technical, Editorial, Minimal or Display.

Light, Dark and Neon are derived from the selected palette. Text/background
pairs are contrast-checked when tokens are generated. Five complete ready
presets ship with the app, and any current style or ready preset can be exported
as a `samt-style-preset` JSON file and imported again.

## Build

Use Android Studio with JDK 17 and Android SDK 35, or run
`./gradlew :app:assembleRelease`. GitHub Actions runs the engine regression
suite, mobile UI smoke tests and signed preview APK build. Minimum Android
version is 8.0 (API 26).

Preview builds use the same development signing key so later APKs can update an
earlier preview without uninstalling it and losing phone-local data. The
checked-in key is deliberately only for personal preview builds; a private
production key is required before public release.

Run the domain checks with `npm test` or `node test/engine.test.js`.

## Data

On Android, the native private store is authoritative; the interface also keeps
a local WebView copy. Settings → Data & storage exports or imports JSON through
Android's file picker. Import validates before replacing the current state and
saves a restore point. Export a backup before uninstalling the app; Android
removes private app data when an app is uninstalled.

Style presets are intentionally separate from full SAMT backups. Importing a
style preset changes visual settings and optional Category colours without
replacing Actions, Blocks, Runs, Logs or History.

Routine Run rollover uses the configured calendar timezone and is reconciled on
app open and by a native midnight receiver. Alarms schedule through Android's
AlarmManager. Exact timing and notification delivery depend on phone
permissions. Settings → App exposes permission state, alarm diagnostics and a
ten-second test alarm.

## Plan Everything stabilization

The stabilization pass covers optional Action List deadlines, administrative
archive cancellation, timezone-safe future scheduling, midweek nested Routine
activation, paused Target accounting, explicit Missed Action logs, selected
numeric Result Targets, relationship-specific completion rules, immutable Block
types, Android Back handling, Project persistence and alarm diagnostics.
