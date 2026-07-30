import { useCallback, useEffect, useState } from 'react';
import {
  abandonQuest,
  acceptQuest,
  fetchActiveQuests,
  fetchOfferableQuests,
  type ActiveQuest,
  type OfferableQuest,
} from '../api';
import { formatDuration } from '../duration';

// QuestPanel renders the player's active quests + the quests they can accept
// (phase 8.17 v2 — multiple active quests, event-step counters, deadlines,
// failed status, accept/abandon). Supersedes the single-quest 8.12 panel. A
// done/failed quest can be dismissed (sticks per quest id).
//
// The panel is hidden by default and toggled from the rail's "задания" button
// (GameLayout owns `open`). It keeps polling while closed so the rail badge can
// reflect the active-quest count via onCountsChange.

const POLL_MS = 5000;
const DISMISS_KEY = 'se_quest_dismissed_v1';

function loadDismissed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* ignore corrupt/absent storage */
  }
  return {};
}

function saveDismissed(d: Record<string, boolean>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable — dismissal just won't persist */
  }
}

// deadlineLabel formats a quest deadline / offer expiry. The duration itself
// comes from the shared formatter, so a quest, an auction lot and a production
// cycle all say the same thing the same way (TASK-174) — this used to be its own
// third dialect («⏳ 4ч 12м»), and one that stopped at hours, so a three-day
// deadline read «72ч 0м». What stays local is the two things that are genuinely
// about quests: the hourglass, and «просрочено» for a deadline already blown —
// a failed quest is not a lot sitting at 00:00.
function deadlineLabel(unix: number): string | null {
  if (!unix) return null;
  const secs = unix - Math.floor(Date.now() / 1000);
  if (secs <= 0) return 'просрочено';
  return `⏳ ${formatDuration(secs)}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  // Reports the active (non-terminal) quest count so the rail can show a badge
  // while the panel is hidden. Pass a stable callback to avoid re-poll loops.
  onCountsChange?: (active: number) => void;
};

export function QuestPanel({ open, onClose, onCountsChange }: Props) {
  const [active, setActive] = useState<ActiveQuest[]>([]);
  const [offerable, setOfferable] = useState<OfferableQuest[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>(loadDismissed);
  const [busy, setBusy] = useState<string>('');

  const poll = useCallback(() => {
    void fetchActiveQuests().then(setActive).catch(() => {});
    void fetchOfferableQuests().then(setOfferable).catch(() => {});
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const dismiss = (questId: string) => {
    const next = { ...dismissed, [questId]: true };
    setDismissed(next);
    saveDismissed(next);
  };

  const onAccept = async (offerId: string) => {
    setBusy(offerId);
    try {
      await acceptQuest(offerId);
      poll();
    } catch {
      /* offer expired / already accepted — surfaced by the list refresh */
    } finally {
      setBusy('');
    }
  };

  const onAbandon = async (questId: string) => {
    setBusy(questId);
    try {
      await abandonQuest(questId);
      poll();
    } catch {
      /* ignore — refresh shows the truth */
    } finally {
      setBusy('');
    }
  };

  const visible = active.filter((q) => !((q.done || q.failed) && dismissed[q.questId]));
  // Personal offers (TASK-89, FR-10): the endpoint already returns only this
  // player's un-accepted, un-expired offers, so no active-id filtering is
  // needed — an accepted offer simply drops out of the next poll.
  const available = offerable;

  // Active (non-terminal) quest count → rail badge. Reported even while closed.
  const activeCount = visible.filter((q) => !(q.done || q.failed)).length;
  useEffect(() => {
    onCountsChange?.(activeCount);
  }, [activeCount, onCountsChange]);

  if (!open) return null;

  const empty = visible.length === 0 && available.length === 0;

  return (
    <div
      className="sw-panel"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 320,
        zIndex: 50,
        maxHeight: 'calc(100vh - 96px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="sw-panel-head">
        <span className="title">Задания</span>
        <button
          type="button"
          className="sw-btn ghost"
          onClick={onClose}
          title="Скрыть панель"
          aria-label="Скрыть панель заданий"
          style={{ padding: '2px 9px', letterSpacing: 0, fontSize: 14, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
      <div
        className="sw-panel-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}
      >
        {empty && <span style={{ color: 'var(--muted, #7a8a99)' }}>Нет активных заданий.</span>}
        {visible.map((q) => {
          const dl = deadlineLabel(q.deadlineUnix);
          const terminal = q.done || q.failed;
          return (
            <div key={q.questId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="sw-row" style={{ gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{q.title}</span>
                <div className="sw-spacer" />
                {q.done && <span className="sw-chip dot good">выполнено</span>}
                {q.failed && <span className="sw-chip dot danger">провал</span>}
                {dl && !terminal && <span className="sw-chip">{dl}</span>}
              </div>
              {!terminal && (
                <>
                  <div className="sw-row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--muted, #7a8a99)' }}>
                      Шаг {q.stepIndex + 1}/{q.totalSteps}
                      {q.stepGoal > 0 && ` · ${q.stepProgress}/${q.stepGoal}`}
                    </span>
                    {q.stepReward > 0 && (
                      <>
                        <div className="sw-spacer" />
                        <span style={{ color: 'var(--good, #4ec9a8)' }}>+{q.stepReward} кр</span>
                      </>
                    )}
                  </div>
                  <span>{q.stepDesc}</span>
                </>
              )}
              <div className="sw-row" style={{ gap: 6 }}>
                <div className="sw-spacer" />
                {terminal ? (
                  <button type="button" className="sw-btn ghost" onClick={() => dismiss(q.questId)}>
                    Скрыть
                  </button>
                ) : (
                  q.questId !== 'tutorial' && (
                    <button
                      type="button"
                      className="sw-btn ghost"
                      disabled={busy === q.questId}
                      onClick={() => void onAbandon(q.questId)}
                    >
                      Отказаться
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}

        {available.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              borderTop: '1px solid var(--line, #1c2630)',
              paddingTop: 8,
            }}
          >
            <span style={{ color: 'var(--muted, #7a8a99)', fontSize: 12 }}>Предложения</span>
            {available.map((o) => {
              const ttl = deadlineLabel(o.expiresUnix);
              return (
                <div key={o.offerId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="sw-row" style={{ gap: 6, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{o.title}</span>
                    <div className="sw-spacer" />
                    {ttl && <span className="sw-chip">{ttl}</span>}
                  </div>
                  <span style={{ color: 'var(--muted, #7a8a99)' }}>{o.desc}</span>
                  <div className="sw-row" style={{ gap: 8, alignItems: 'baseline' }}>
                    {o.rewardCash > 0 && (
                      <span style={{ color: 'var(--good, #4ec9a8)' }}>+{o.rewardCash} кр</span>
                    )}
                    <div className="sw-spacer" />
                    <button
                      type="button"
                      className="sw-btn"
                      disabled={busy === o.offerId}
                      onClick={() => void onAccept(o.offerId)}
                    >
                      Принять
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
