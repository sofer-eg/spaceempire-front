import { useEffect, useRef } from 'react';
import type { GoodsRow, PoliceScanFrame, Race } from './api';
import { emitLog } from './eventBus';
import { goodsName, raceName } from './gameContext';

// usePoliceLog emits a combat-journal line whenever a police_scan frame
// arrives (phase 9.4). It watches policeScanSeq (bumped by useWorldState on
// each frame) the same way useCombatLog watches the tick, and resolves the
// faction / goods names from the catalogs for a readable line.
export function usePoliceLog(
  seq: number,
  last: PoliceScanFrame | null,
  races: Race[],
  goods: GoodsRow[],
): void {
  const ref = useRef({ last, races, goods });
  useEffect(() => {
    ref.current = { last, races, goods };
  });

  const lastSeq = useRef(0);
  useEffect(() => {
    if (seq === 0 || seq === lastSeq.current) return;
    lastSeq.current = seq;
    const cur = ref.current;
    if (!cur.last) return;
    const faction = raceName(cur.races, cur.last.race) || `раса ${cur.last.race}`;
    const cargo = goodsName(cur.goods, cur.last.goodsType);
    const base = `Полиция (${faction}): досмотр — конфисковано ${cur.last.quantity}× ${cargo}`;
    emitLog({
      category: 'combat',
      kind: cur.last.wanted ? 'danger' : 'warn',
      message: cur.last.wanted ? `${base}. ВЫ В РОЗЫСКЕ!` : base,
    });
  }, [seq]);
}
