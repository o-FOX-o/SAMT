import { createBrowserRepository } from "../infrastructure/local-storage.js";
import { systemClock } from "../infrastructure/clock.js";
import { createCommands } from "./commands.js";
import { createQueries } from "./queries.js";
import { reconcileTemporalState } from "./lifecycle.js";
import { createId } from "../shared/ids.js";

export function createEngine({ repository = null, storage = undefined, clock = systemClock(), key, now = null } = {}) {
  const currentClock = typeof clock === "function" ? { now: clock, timezone: () => "UTC" } : clock; const timestamp = now || currentClock.now();
  const repo = repository || createBrowserRepository({ storage, key, clock: timestamp });
  const commands = createCommands(repo, { clock: currentClock.now, idFactory: (prefix) => createId(prefix, currentClock.now()) }); const queries = createQueries(repo, { clock: currentClock.now });
  return { repository: repo, commands, queries, reconcile: (options = {}) => reconcileTemporalState({ repository: repo, now: options.now || currentClock.now(), timezone: options.timezone || currentClock.timezone() }), getState: () => repo.getState() };
}
