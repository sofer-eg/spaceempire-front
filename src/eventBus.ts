// Lightweight module-level event bus for the HUD event log. The log panel
// (EventLog) generates its own system/sector lines from world state, but
// trade events originate in MarketView/AuctionView which don't own the log.
// Rather than thread a push callback through the whole component tree, those
// views call emitLog() and EventLog subscribes. Kept deliberately tiny — no
// React, no external dep; a Set of listeners.

export type LogCategory = 'system' | 'sector' | 'trade' | 'combat';
export type LogKind = 'info' | 'good' | 'warn' | 'danger';

// LogEvent is what producers emit; EventLog timestamps and ids it on receipt.
export type LogEvent = {
  category: LogCategory;
  kind: LogKind;
  message: string;
};

type Listener = (e: LogEvent) => void;

const listeners = new Set<Listener>();

export function emitLog(e: LogEvent): void {
  for (const l of listeners) l(e);
}

export function subscribeLog(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
