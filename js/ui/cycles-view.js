import { esc, relationshipLabel, statusLabel } from "./helpers.js";

function runtimeForCycle(state, cycle) {
  const allBig = (state.cycleBigCycles || []).filter((big) => big.cycleId === cycle.id);
  const big = allBig.find((item) => item.status === "open") || allBig.at(-1) || null;
  const small = big
    ? (state.cycleSmallCycles || []).find((item) => item.id === big.currentSmallCycleId) ||
      (big.smallCycles || []).find((item) => item.id === big.currentSmallCycleId) ||
      null
    : null;
  const slots = small?.slots || [];
  const index = Number(big?.currentSlot ?? -1);
  const displayIndex = index < 0 ? 0 : index;
  const current = small && slots.length && index >= -1 && index < slots.length ? slots[displayIndex] || null : null;
  const currentRelationship = current ? (cycle.relationships || []).find((relationship) => relationship.id === current.relationshipId) : null;
  return { big, small, slots, index, displayIndex, current, currentRelationship };
}

function coverageLabel(ids = [], total = 0) {
  return total ? ids.length + " / " + total : "0 / 0";
}

function slotLabel(state, cycle, slot, index, currentIndex = -1) {
  const relationship = (cycle.relationships || []).find((candidate) => candidate.id === slot?.relationshipId);
  const outcome = slot?.outcome ? " · " + statusLabel(slot.outcome) : "";
  return '<span class="samt-sequence-item ' + (index === currentIndex ? "current" : "") + '">' +
    (index + 1) + ". " + esc(relationship ? relationshipLabel(state, relationship) : slot?.relationshipId || "Unknown") +
    esc(outcome) + "</span>";
}

function cycleCard(state, cycle) {
  const runtime = runtimeForCycle(state, cycle);
  const relationships = cycle.relationships || [];
  const currentName = runtime.currentRelationship ? relationshipLabel(state, runtime.currentRelationship) : "No generated slot";
  const big = runtime.big;
  const bigNumber = big ? (state.cycleBigCycles || []).filter((item) => item.cycleId === cycle.id).indexOf(big) + 1 : null;
  const canResolve = Boolean(runtime.current && runtime.currentRelationship);
  const currentActionId = runtime.currentRelationship?.kind === "action" ? runtime.currentRelationship.refId : null;
  const currentContext = canResolve ? " data-id=\"" + esc(currentActionId || cycle.id) + "\" data-block-id=\"" + esc(cycle.id) + "\" data-relationship-id=\"" + esc(runtime.currentRelationship?.id || "") + "\"" : "";
  const currentSlotText = runtime.current ? "Slot " + (runtime.index + 1) + " of " + runtime.slots.length : "Generate a Small Cycle";
  const needsGeneration = !runtime.small || !runtime.slots.length || runtime.index >= runtime.slots.length;
  const nextButton = needsGeneration
    ? '<button class="samt-button ghost" data-action="generate-small-cycle" data-id="' + esc(cycle.id) + '">Generate next Small Cycle</button>'
    : runtime.index >= 0 && runtime.index < runtime.slots.length - 1
      ? '<button class="samt-button ghost" data-action="advance-cycle" data-id="' + esc(cycle.id) + '">Next</button>'
      : "";
  const actionControl = currentActionId
    ? '<button class="samt-button primary" data-action="open-log"' + currentContext + '>＋ Log</button>' + (runtime.currentRelationship.config?.manualCompletion === true ? '<button class="samt-button ghost" data-action="resolve-cycle-slot" data-id="' + esc(cycle.id) + '" data-outcome="completed">Complete</button>' : '')
    : canResolve ? '<button class="samt-button primary" data-action="resolve-cycle-slot" data-id="' + esc(cycle.id) + '" data-outcome="completed">Complete</button>' : '';
  const skipControl = canResolve && runtime.currentRelationship?.config?.allowSkip === true ? '<button class="samt-button ghost" data-action="resolve-cycle-slot" data-id="' + esc(cycle.id) + '" data-outcome="skipped" data-require-reason="true">Skip</button>' : '';
  const deferControl = canResolve && runtime.currentRelationship?.config?.allowDefer === true ? '<button class="samt-button ghost" data-action="resolve-cycle-slot" data-id="' + esc(cycle.id) + '" data-outcome="deferred">Defer</button>' : '';
  const unavailableControl = canResolve && runtime.currentRelationship?.config?.allowUnavailable === true ? '<button class="samt-button ghost" data-action="resolve-cycle-slot" data-id="' + esc(cycle.id) + '" data-outcome="unavailable">Unavailable</button>' : '';
  return '<article class="samt-card">' +
    '<div class="samt-card-head"><div><a class="samt-entity-link" href="#/blocks/' + encodeURIComponent(cycle.id) + '"><h2>' + esc(cycle.name) + '</h2></a><span class="samt-badge">' + esc(cycle.config?.generationMode || "simple_ordered") + '</span></div><span class="samt-status">' + esc(statusLabel(cycle.definitionStatus)) + '</span></div>' +
    '<p class="samt-cycle-current">Current generated item: <strong>' + esc(currentName) + '</strong></p>' +
    '<dl class="samt-definition-list"><div><dt>Small Cycle</dt><dd>' + esc(String(runtime.small?.smallCycleNumber || big?.smallCycles?.length || "—")) + ' · ' + esc(currentSlotText) + '</dd></div><div><dt>Big Cycle</dt><dd>' + esc(String(big?.bigCycleNumber || (bigNumber || "—"))) + ' · ' + esc(big?.status || "not started") + '</dd></div><div><dt>Appearance</dt><dd>' + esc(coverageLabel(big?.appearanceCoverage, big?.participantRelationshipIds?.length || relationships.length)) + '</dd></div><div><dt>Completion</dt><dd>' + esc(coverageLabel(big?.completionCoverage, big?.participantRelationshipIds?.length || relationships.length)) + '</dd></div></dl>' +
    '<div class="samt-sequence">' + (runtime.slots.length ? runtime.slots.map((slot, index) => slotLabel(state, cycle, slot, index, runtime.current ? runtime.displayIndex : -1)).join("") : '<span class="samt-muted">No generated slots yet.</span>') + '</div>' +
    '<div class="samt-card-actions">' +
      actionControl + skipControl + deferControl + unavailableControl +
      nextButton +
      '<a class="samt-button ghost" href="#/blocks/' + encodeURIComponent(cycle.id) + '">Open</a><a class="samt-button ghost" href="#/blocks/' + encodeURIComponent(cycle.id) + '/edit">Edit</a>' +
    '</div></article>';
}

export function renderCyclesView({ state = {} } = {}) {
  const cycles = (state.blocks || []).filter((block) => block.type === "cycle");
  return '<section class="samt-page" aria-labelledby="cycles-title"><header class="samt-page-head"><div><p class="samt-eyebrow">Generated runtime · persistent coverage</p><h1 id="cycles-title">Cycles</h1><p class="samt-muted">The current item comes from the generated Small Cycle. Big Cycle appearance and completion coverage are tracked separately.</p></div><button class="samt-button primary" data-action="new-block" data-type="cycle">＋ New Cycle</button></header><div class="samt-card-grid">' +
    (cycles.length ? cycles.map((cycle) => cycleCard(state, cycle)).join("") : '<article class="samt-card"><p class="samt-empty">No Cycles yet. Create one and add contextual relationships.</p></article>') +
    '</div></section>';
}
