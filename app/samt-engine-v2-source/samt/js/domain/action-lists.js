export function actionListState(block, occurrences, now) {
  const relevant = (occurrences || []).filter((item) => item.parentBlockId === block.id || item.blockId === block.id || item.contextBlockId === block.id);
  const timestamp = new Date(now).getTime();
  return {
    blockId: block.id,
    openEnded: true,
    upcoming: relevant.filter((item) => item.status === "upcoming"),
    available: relevant.filter((item) => ["available", "partial"].includes(item.status)),
    due: relevant.filter((item) => item.status === "due"),
    overdue: relevant.filter((item) => item.status === "overdue" || (item.dueAt && new Date(item.dueAt).getTime() < timestamp && !["completed", "missed", "skipped"].includes(item.status))),
    completed: relevant.filter((item) => item.status === "completed")
  };
}
