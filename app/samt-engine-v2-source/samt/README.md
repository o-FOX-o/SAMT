# SAMT modular engine and reference client

This package contains the UI-independent SAMT engine, a deliberately simple
vanilla JavaScript reference client, tests, schema, and a single-file browser
build. Engine release 2.1.0 uses internal storage version 3 while preserving
the external SAMT package schema at version 2.

## Use the app

Open `dist/samt-app.html` directly in a modern browser. It has no server or
account requirement. A fresh browser origin starts empty.

The modular development client uses ES modules. Serve this folder through any
static file server and open `index.html` when working on source files.

## Verify and build

```sh
npm test
node scripts/build-standalone.js
node scripts/browser-smoke.js
```

The smoke harness reports a skip when Playwright Chromium is not installed.
The unit/integration suite and standalone syntax build do not require a browser
binary.

## Public engine entry

`js/core.js` exports the engine, pure rules, repositories, clocks, migration
and package functions without importing the DOM. It is the current extraction
point for future Next.js, desktop, Android and iOS clients.

## Existing browser data

The reference client keeps the existing IndexedDB database, store and state
keys. A same-origin upgrade migrates data automatically and writes a complete
version-keyed pre-migration backup before transforming or committing data.

Downloaded Android `content://` files can receive different browser origins.
Browser security prevents a new origin from reading another origin's
IndexedDB. In that case, export **Full Backup** from the old file and import it
into the new file.

See `ARCHITECTURE.md` and `DOMAIN_RULES.md` for the enforced boundaries and
locked behaviour.
