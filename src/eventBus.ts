// Lightweight module-level event bus for the HUD event log. The log panel
// (EventLog) generates its own system/sector lines from world state, but
// trade events originate in MarketView/AuctionView which don't own the log.
// Rather than thread a push callback through the whole component tree, those
// views call emitLog() and EventLog subscribes. Kept deliberately tiny — no
// React, no external dep; a Set of listeners.

export type LogCategory = 'system' | 'sector' | 'trade' | 'combat' | 'quest';
export type LogKind = 'info' | 'good' | 'warn' | 'danger';

// LogAction is an optional interactive affordance carried by a log entry. So
// far the only kind is a quest offer's inline «Принять» button (TASK-89, AC-1:
// «принимается прямо из журнала») — EventLog renders it and calls acceptQuest.
export type LogAction = { kind: 'quest_offer'; offerId: string };

// LogEvent is what producers emit; EventLog timestamps and ids it on receipt.
export type LogEvent = {
  category: LogCategory;
  kind: LogKind;
  message: string;
  action?: LogAction;
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
