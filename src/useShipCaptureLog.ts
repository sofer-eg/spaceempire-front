import { useEffect, useRef } from 'react';
import type { ShipCaptureFrame } from './api';
import { emitLog } from './eventBus';

// useShipCaptureLog emits a combat-journal line whenever a ship_capture frame
// arrives (phase 10.3.9.5). It watches shipCaptureSeq (bumped by useWorldState
// on each frame) the same way usePoliceLog watches policeScanSeq. Both the
// captor and the old owner receive their own frame; the captor flag +
// success decide the wording:
//   captor + success  → «Корабль захвачен»        (good)
//   captor + !success → «Захват не удался»         (warn)
//   !captor + success → «Ваш корабль захвачен»     (danger)
export function useShipCaptureLog(seq: number, last: ShipCaptureFrame | null): void {
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
    if (cur.captor) {
      emitLog(
        cur.success
          ? { category: 'combat', kind: 'good', message: 'Корабль захвачен.' }
          : { category: 'combat', kind: 'warn', message: 'Захват не удался.' },
      );
      return;
    }
    // Old owner: the server only notifies them on a successful seizure.
    emitLog({ category: 'combat', kind: 'danger', message: 'Ваш корабль захвачен!' });
  }, [seq]);
}
