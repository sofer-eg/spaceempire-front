import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { InstalledEquipment } from './api';
import { ObjectActionsMenu, type PickedObject } from './ObjectActionsMenu';

type Props = {
  target: PickedObject;
  ownShipID: number;
  // ownPlayerID gates the «Демонтировать» item on the object being the player's
  // own (TASK-146).
  ownPlayerID: number;
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
  // onCargoChanged is forwarded to ObjectActionsMenu for the dismantle's hold
  // refresh (TASK-146).
  onCargoChanged?: () => void;
  onClose: () => void;
};

// CanvasContextMenu floats the ObjectActionsMenu over `.sw-map-wrap`
// near the picked object. Outside-click and Escape close it. The menu is
// clamped into the viewport after layout (see shiftUp) so its lower items stay
// clickable for a pick near the bottom of the map.
export function CanvasContextMenu({
  target,
  ownShipID,
  ownPlayerID,
  ownShip,
  ownShipAttackTargetID,
  ownShipMiningTargetID,
  ownEquipment,
  dockRange,
  gateRange,
  px,
  py,
  onCargoChanged,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // shiftUp is how far the menu has to be pulled up to stay inside the viewport.
  // Measured after layout because the height depends on which items the target
  // affords — a ship's menu is the tallest.
  //
  // Needed since TASK-175 gave missiles one item per ammunition class: the menu
  // grew by ~150 px, and it is positioned bluntly at (px+8, py+8) inside
  // `.sw-map-wrap` with the page itself not scrollable. Measured on the live
  // world before this clamp: a pick at the bottom edge of the map put the menu's
  // last four items — «Ракета: Шелкопряд», «Ракета: Шершень» and BOTH torpedo
  // items — 90 px below the viewport, where nothing could reach them. The
  // torpedoes were already close to that edge on their own; the missile classes
  // are what pushed them over.
  const [shiftUp, setShiftUp] = useState(0);

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

  // Clamp into the viewport once the real height is known. Only ever pulls the
  // menu UP (never past the top of the map box), so a pick with room below keeps
  // the plain (px+8, py+8) anchor it always had. Re-measured when the anchor or
  // the target changes, since a different target affords different items.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setShiftUp((prev) => {
      // Undo the current shift before measuring, so the correction is computed
      // against the un-clamped position rather than compounding.
      const overflow = el.getBoundingClientRect().bottom + prev - window.innerHeight + 8;
      return Math.max(0, Math.min(overflow, py));
    });
  }, [px, py, target]);

  return (
    <div ref={ref} className="sw-canvas-menu" style={{ left: px + 8, top: py + 8 - shiftUp }}>
      <ObjectActionsMenu
        target={target}
        ownShipID={ownShipID}
        ownPlayerID={ownPlayerID}
        ownShip={ownShip}
        ownShipAttackTargetID={ownShipAttackTargetID}
        ownShipMiningTargetID={ownShipMiningTargetID}
        ownEquipment={ownEquipment}
        dockRange={dockRange}
        gateRange={gateRange}
        onCargoChanged={onCargoChanged}
        onActionDone={onClose}
      />
    </div>
  );
}
