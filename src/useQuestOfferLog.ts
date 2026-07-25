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
//
// The prefix reflects the pacer trigger that produced the offer (SRS §7.1): a
// dock offer reads as a station bulletin board, a space offer as an intercepted
// signal. The reward suffix is dropped for reward-less offers so a story quest
// routed through the stream never reads «(награда 0 кр.)».
function offerPrefix(source: string): string {
  switch (source) {
    case 'space':
      return 'Перехвачен сигнал';
    case 'dock':
      return 'Доска объявлений';
    default:
      return 'Новое задание';
  }
}

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
    const reward = cur.rewardCash > 0 ? ` (награда ${cur.rewardCash} кр.)` : '';
    emitLog({
      category: 'quest',
      kind: 'info',
      message: `${offerPrefix(cur.source)}: ${cur.title} — ${cur.desc}${reward}`,
      action: { kind: 'quest_offer', offerId: cur.offerId },
    });
  }, [seq]);
}
