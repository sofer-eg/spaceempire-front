import { useEffect, useRef } from 'react';
import type { QuestOfferFrame } from './api';
import { emitLog } from './eventBus';

// useQuestOfferLog emits a quest-journal line whenever a quest_offer frame
// arrives (TASK-89, FR-10). It watches questOfferSeq (bumped by useWorldState on
// each frame) the same way usePoliceLog watches policeScanSeq. The line carries
// a `quest_offer` action so EventLog can render an inline «Принять» button —
// AC-1: the offer «принимается прямо из журнала». The frame's title/desc are
// already human-readable (sector/goods names resolved server-side, NFR-I), so no
// catalog lookup is needed here.
export function useQuestOfferLog(seq: number, last: QuestOfferFrame | null): void {
  const ref = useRef(last);
  useEffect(() => {
    ref.current = last;
  });

  const lastSeq = useRef(0);
  useEffect(() => {
    if (seq === 0 || seq === lastSeq.current) return;
    lastSeq.current = seq;
    const cur = ref.current;
    if (!cur) return;
    emitLog({
      category: 'quest',
      kind: 'info',
      message: `Новое задание: ${cur.title} — ${cur.desc} (награда ${cur.rewardCash} кр.)`,
      action: { kind: 'quest_offer', offerId: cur.offerId },
    });
  }, [seq]);
}
