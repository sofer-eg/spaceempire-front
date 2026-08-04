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
// `now` is passed in rather than read here so the caller decides how often the
// label is allowed to be stale; see the tick below.
function deadlineLabel(unix: number, now: number): string | null {
  if (!unix) return null;
  const secs = unix - Math.floor(now / 1000);
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
  // The clock the deadline chips are measured against. Declared up here because
  // poll() below re-syncs it; the effect that ticks it, and why it exists at all,
  // are further down.
  const [now, setNow] = useState(() => Date.now());

  const poll = useCallback(() => {
    // Re-sync the deadline clock here, in the fetch callback, rather than in an
    // effect body (react-hooks/set-state-in-effect) — same reason MarketView
    // seeds its production countdown from its own fetch. This runs whether the
    // panel is open or not, which bounds how stale `now` can be when it opens.
    void fetchActiveQuests()
      .then((qs) => {
        setActive(qs);
        setNow(Date.now());
      })
      .catch(() => {});
    void fetchOfferableQuests().then(setOfferable).catch(() => {});
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  // The deadline chip counts in MM:SS below an hour (formatDuration), and most
  // offers expire well inside one — so the poll above is the wrong clock for it:
  // at 5s it would step 04:59 -> 04:54 -> 04:49 while presenting itself as a
  // second-resolution countdown. Worse, poll() swallows its errors and skips the
  // setState on failure, so a backend hiccup froze the chip on a stale second
  // while it still looked live. A local tick fixes both: the label is computed
  // from expiresUnix against this clock, so it keeps counting down truthfully
  // even when nothing is being fetched. Only while the panel is on screen —
  // polling continues when it is closed (for the rail badge), rendering need
  // not. Same shape as MarketView's production chip.
  //
  // Every tick re-reads the clock instead of adding 1000, so a throttled
  // background tab resumes on the true time rather than on however many
  // intervals the browser chose to deliver. What this does NOT do is repaint on
  // the same frame the panel opens: `now` is then whatever the last poll left,
  // and the first tick corrects it a second later. That one frame is the price of
  // keeping setState out of the effect body. POLL_MS bounds how old it can be
  // only while the polls are landing — poll() re-syncs from its success callback
  // and drops failures, so through an outage the opening frame can be as stale as
  // the outage is long. It is one frame either way, and the tick that follows is
  // exact regardless, which is why this is not worth a second clock.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

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
          const dl = deadlineLabel(q.deadlineUnix, now);
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
              const ttl = deadlineLabel(o.expiresUnix, now);
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
