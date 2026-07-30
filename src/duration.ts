// The one place a remaining-time value becomes a string. Three screens used to
// have three languages for the same quantity: the auction lot list wrote
// «4 ч 21 мин», the market's production chip «72:30» and the quest panel
// «⏳ 4ч 12м» — the market one with no ceiling on minutes at all, so a cycle
// longer than an hour read as either 72 minutes or 72 hours, and the quest one
// with no notion of days, so a three-day deadline read «72ч 0м» (TASK-142,
// TASK-174).
//
// Lives at the src root rather than under station/ because the callers sit in
// two feature folders. DOM-free so `node --test` can import it: the boundaries
// below used to be reachable only by shifting the browser clock during a live
// verification run, which is far too expensive a way to catch a `<` turned into
// a `<=`.

// formatDuration is the core — a count of SECONDS in, a label out. Three
// regimes, because any one of them alone lies somewhere:
//   < 1 h    MM:SS   — the only window where seconds matter to a bidder
//   < 24 h   «4 ч 21 мин»
//   >= 24 h  «11 д 3 ч»
// Zero, negative and non-finite all give «00:00»: counting backwards past the
// end is never the answer, and NaN fails every comparison below, so it has to be
// tested for rather than fallen through.
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00';
  const sec = Math.floor(totalSeconds);
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const hours = Math.floor(sec / 3600);
  if (hours < 24) return `${hours} ч ${Math.floor((sec % 3600) / 60)} мин`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

// formatTtl renders an auction lot's remaining time for the «До конца» column
// from the ISO end stamp the backend sends. `now` is a parameter rather than a
// Date.now() call inside so the regime boundaries can be asserted exactly.
export function formatTtl(endsAt: string, now: number = Date.now()): string {
  // Date.parse gives NaN for a stamp it cannot read, and NaN / 1000 is still
  // NaN, which formatDuration answers with «00:00». No guard of its own here on
  // purpose: an explicit `Number.isNaN(ms)` check was measurably dead — removing
  // it left every test green, because the non-finite branch already covers it.
  return formatDuration((Date.parse(endsAt) - now) / 1000);
}
