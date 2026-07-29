// formatTtl renders an auction lot's remaining time for the «До конца» column.
// Lives in its own DOM-free module so `node --test` can import it: the
// boundaries below used to be reachable only by shifting the browser clock
// during a live verification run, which is far too expensive a way to catch a
// `<` turned into a `<=` (TASK-142).
//
// Three regimes, because one of them alone always lies somewhere:
//   < 1 h    MM:SS   — the only window where seconds matter to a bidder
//   < 24 h   «4 ч 21 мин»
//   >= 24 h  «11 д 3 ч»
// Unbounded minutes were the defect: a two-hour lot rendered «119:25», which
// reads as either 119 minutes or 119 hours depending on the reader.
//
// `now` is a parameter rather than a Date.now() call inside so the regime
// boundaries can be asserted exactly.
export function formatTtl(endsAt: string, now: number = Date.now()): string {
  const ms = Date.parse(endsAt) - now;
  // Also the branch for an unparseable date: NaN fails every comparison, so it
  // must be tested for, not fallen through.
  if (Number.isNaN(ms) || ms <= 0) return '00:00';
  const sec = Math.floor(ms / 1000);
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const hours = Math.floor(sec / 3600);
  if (hours < 24) return `${hours} ч ${Math.floor((sec % 3600) / 60)} мин`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}
