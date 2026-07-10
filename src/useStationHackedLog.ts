import { useEffect, useRef } from 'react';
import type { GoodsRow, StationHackedFrame } from './api';
import { emitLog } from './eventBus';
import { goodsName } from './gameContext';

// useStationHackedLog emits a combat-journal line whenever a station_hacked
// frame arrives (TASK-100.3.9.6). It watches stationHackedSeq (bumped by
// useWorldState on each frame) the same way usePoliceLog watches policeScanSeq,
// and resolves the good name from the catalog for a readable line:
//   robbed > 0  → «Взлом станции: похищено N× <товар>»  (good)
//   robbed == 0 → «Неудачная попытка взлома станции.»    (warn)
export function useStationHackedLog(
  seq: number,
  last: StationHackedFrame | null,
  goods: GoodsRow[],
): void {
  const ref = useRef({ last, goods });
  useEffect(() => {
    ref.current = { last, goods };
  });

  const lastSeq = useRef(0);
  useEffect(() => {
    if (seq === 0 || seq === lastSeq.current) return;
    lastSeq.current = seq;
    const cur = ref.current;
    if (!cur.last) return;
    if (cur.last.robbed > 0) {
      const cargo = goodsName(cur.goods, cur.last.goodsType);
      emitLog({
        category: 'combat',
        kind: 'good',
        message: `Взлом станции: похищено ${cur.last.robbed}× ${cargo}.`,
      });
      return;
    }
    emitLog({ category: 'combat', kind: 'warn', message: 'Неудачная попытка взлома станции.' });
  }, [seq]);
}
