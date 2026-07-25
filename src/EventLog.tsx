import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ConnectionState, TrackedShip } from './useWorldState';
import { subscribeLog, type LogAction, type LogCategory, type LogKind } from './eventBus';
import { acceptQuest } from './api';

type Props = {
  tick: number;
  connection: ConnectionState;
  ownShip: TrackedShip | null;
  contacts: number;
};

type Entry = {
  id: number;
  time: string;
  category: LogCategory;
  kind: LogKind;
  message: string;
  action?: LogAction;
};

const MAX_ENTRIES = 40;

type Action = { type: 'push'; entries: Entry[] };

function reducer(state: Entry[], action: Action): Entry[] {
  switch (action.type) {
    case 'push':
      return [...action.entries, ...state].slice(0, MAX_ENTRIES);
  }
}

type Tab = 'all' | 'sector' | 'combat' | 'trade' | 'quest';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'sector', label: 'Сектор' },
  { id: 'combat', label: 'Бой' },
  { id: 'trade', label: 'Сделки' },
  { id: 'quest', label: 'Квесты' },
];

export function EventLog({ tick, connection, ownShip, contacts }: Props) {
  // useReducer's dispatch isn't flagged by react-hooks/set-state-in-effect,
  // so we collect events here and dispatch them once per effect run.
  const [entries, dispatch] = useReducer(reducer, []);
  const [tab, setTab] = useState<Tab>('all');
  // accept-from-journal state (TASK-89, AC-1): the offer id currently being
  // accepted (button shows a spinner-ish disabled state) and the set of offers
  // already accepted (button turns into a «принято ✓» chip).
  const [acceptingOffer, setAcceptingOffer] = useState<string>('');
  const [acceptedOffers, setAcceptedOffers] = useState<Set<string>>(new Set());
  const lastTickRef = useRef<number>(-1);
  const lastConnRef = useRef<ConnectionState | null>(null);
  const lastSectorRef = useRef<number>(0);
  const seqRef = useRef<number>(0);

  // Seed the log on first mount with a single boot line.
  useEffect(() => {
    seqRef.current++;
    dispatch({
      type: 'push',
      entries: [{ id: seqRef.current, time: now(), category: 'system', kind: 'good', message: '> HUD активирован' }],
    });
  }, []);

  // Trade/auction events arrive over the module event bus (MarketView,
  // AuctionView). Subscribe once and fold each into the reducer.
  useEffect(() => {
    return subscribeLog((e) => {
      dispatch({
        type: 'push',
        entries: [
          { id: ++seqRef.current, time: now(), category: e.category, kind: e.kind, message: e.message, action: e.action },
        ],
      });
    });
  }, []);

  // Accept a quest offer straight from its journal line (TASK-89, AC-1). On
  // success the button collapses to a «принято» chip; a failure (offer expired /
  // already taken) re-enables it so the player can retry — the panel's poll
  // surfaces the real state either way.
  const acceptOffer = async (offerId: string) => {
    setAcceptingOffer(offerId);
    try {
      await acceptQuest(offerId);
      setAcceptedOffers((prev) => new Set(prev).add(offerId));
    } catch {
      /* expired / already accepted — leave the button for a retry */
    } finally {
      setAcceptingOffer('');
    }
  };

  // Append system/sector events when interesting world state changes.
  useEffect(() => {
    const next: Entry[] = [];
    if (lastConnRef.current !== null && lastConnRef.current !== connection) {
      next.push({
        id: ++seqRef.current,
        time: now(),
        category: 'system',
        kind: connection === 'open' ? 'good' : connection === 'closed' ? 'danger' : 'warn',
        message: `WS ${connection.toUpperCase()}`,
      });
    }
    lastConnRef.current = connection;

    const currentSector = ownShip?.sectorID ?? 0;
    if (currentSector !== 0 && lastSectorRef.current !== 0 && currentSector !== lastSectorRef.current) {
      next.push({
        id: ++seqRef.current,
        time: now(),
        category: 'sector',
        kind: 'info',
        message: `Прыжок: сектор #${lastSectorRef.current} → #${currentSector}`,
      });
    }
    if (currentSector !== 0) lastSectorRef.current = currentSector;

    // Every 10 ticks: status heartbeat with contact count.
    if (tick > 0 && tick % 10 === 0 && tick !== lastTickRef.current) {
      next.push({
        id: ++seqRef.current,
        time: now(),
        category: 'sector',
        kind: 'info',
        message: `Тик ${tick} · контактов ${contacts}`,
      });
      lastTickRef.current = tick;
    }
    if (next.length > 0) {
      dispatch({ type: 'push', entries: next });
    }
  }, [tick, connection, ownShip, contacts]);

  // Filtered view: 'all' shows everything; the named tabs match their
  // category (system lines surface only under 'all').
  const shown = useMemo(
    () => (tab === 'all' ? entries : entries.filter((e) => e.category === tab)),
    [entries, tab],
  );

  return (
    <div className="sw-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="sw-panel-head">
        <span className="title">Журнал событий</span>
        <div className="sw-row" style={{ gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`sw-chip${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{ cursor: 'pointer' }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sw-panel-body" style={{ overflow: 'auto', flex: 1 }}>
        <div className="sw-log">
          {shown.length === 0 && <span className="empty">Нет событий.</span>}
          {shown.map((e) => (
            <div key={e.id} className={`row ${e.kind}`}>
              <span className="t">{e.time}</span>
              <span className="m">{e.message}</span>
              {e.action?.kind === 'quest_offer' &&
                (acceptedOffers.has(e.action.offerId) ? (
                  <span className="sw-chip dot good" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    принято
                  </span>
                ) : (
                  <button
                    type="button"
                    className="sw-btn"
                    style={{ marginLeft: 'auto', flexShrink: 0, padding: '1px 8px', fontSize: 11 }}
                    disabled={acceptingOffer === e.action.offerId}
                    onClick={() => void acceptOffer(e.action!.offerId)}
                  >
                    Принять
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function now(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
