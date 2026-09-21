# SAMT Android — development preview

This is a new SAMT Android client. Its coloured phone interface is built from
scratch with System, Light and Dark modes. `web/engine.js` is UI-independent;
Android uses a WebView asset origin to display the local interface and a native
bridge for alarms, calendar rollover, backups and phone permissions. There is
no login, server or internet permission.

**Status:** active development. Read [FEATURE_PARITY.md](FEATURE_PARITY.md) for
the complete acceptance contract. Features listed there have not all passed
through a device test yet. The APK built from this branch is a preview, not a
promise of full SAMT parity.

## Build

Use Android Studio with JDK 17 and Android SDK 35, or run
`./gradlew :app:assembleRelease`. The GitHub Actions workflow also builds an
installable preview APK. Minimum Android version is 8.0 (API 26).

Preview builds use the same development signing key and increasing version
codes so a later APK can update an earlier APK without uninstalling it and
losing phone-local data. This checked-in key is deliberately only for personal
preview builds; a private production key is required before public release.

Run the domain checks with `npm test` or `node test/engine.test.js`.

## Data

On Android, the native private store is authoritative; the interface also
keeps a local WebView copy. Settings → Data & storage exports or imports JSON
through Android's file picker. Import validates before replacing the current
state and saves a restore point. Export a backup before uninstalling the app;
Android removes private app data when an app is uninstalled. The Gym Log APK
uses a different package and data store.

Routine Run rollover uses Europe/London calendar boundaries (configurable in
Settings) and is reconciled both on app open and by a native midnight receiver.
Alarms schedule through Android's AlarmManager. Exact timing and notification
delivery depend on the relevant phone permissions. The App section in Settings
shows their current status.
