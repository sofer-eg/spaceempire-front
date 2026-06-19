import { useEffect, useRef } from 'react';
import type { InstalledEquipment } from './api';
import { ObjectActionsMenu, type PickedObject } from './ObjectActionsMenu';

type Props = {
  target: PickedObject;
  ownShipID: number;
  ownShip: { x: number; y: number } | null;
  ownShipAttackTargetID?: number;
  ownShipMiningTargetID?: number;
  // ownEquipment is the controlled ship's module list, gating the launch items
  // in ObjectActionsMenu (phase 10.3.2).
  ownEquipment?: InstalledEquipment[];
  dockRange: number;
  gateRange: number;
  // px / py are canvas-local pixel coordinates of the picked object. The
  // menu is offset slightly (+8/+8) so it doesn't cover the glyph.
  px: number;
  py: number;
  onClose: () => void;
};

// CanvasContextMenu floats the ObjectActionsMenu over `.sw-map-wrap`
// near the picked object. Outside-click and Escape close it.
export function CanvasContextMenu({
  target,
  ownShipID,
  ownShip,
  ownShipAttackTargetID,
  ownShipMiningTargetID,
  ownEquipment,
  dockRange,
  gateRange,
  px,
  py,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // The same click that opens the menu also fires `mousedown` before the
  // canvas's onClick promotes us, so we attach the outside-click listener
  // on the next macrotask. Otherwise the menu would close instantly.
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as Node | null;
      if (t && ref.current?.contains(t)) return;
      onClose();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="sw-canvas-menu" style={{ left: px + 8, top: py + 8 }}>
      <ObjectActionsMenu
        target={target}
        ownShipID={ownShipID}
        ownShip={ownShip}
        ownShipAttackTargetID={ownShipAttackTargetID}
        ownShipMiningTargetID={ownShipMiningTargetID}
        ownEquipment={ownEquipment}
        dockRange={dockRange}
        gateRange={gateRange}
        onActionDone={onClose}
      />
    </div>
  );
}
