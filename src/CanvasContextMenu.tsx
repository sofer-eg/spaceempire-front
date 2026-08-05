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

// menuOffset is the +8/+8 the menu is nudged by so it doesn't cover the picked
// glyph; menuGutter is the breathing space kept below it when the clamp engages.
const menuOffset = 8;
const menuGutter = 8;

// CanvasContextMenu floats the ObjectActionsMenu over `.sw-map-wrap`
// near the picked object. Outside-click and Escape close it. The menu is
// clamped into the MAP BOX after layout (see shiftUp) so its lower items stay
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
  // shiftUp is how far the menu has to be pulled up to stay inside the box that
  // CLIPS it. Measured after layout because the height depends on which items the
  // target affords — a ship's menu is the tallest.
  //
  // Needed since TASK-175 gave missiles one item per ammunition class: the menu grew
  // by ~150 px, and it is positioned bluntly at (px+8, py+8) inside `.sw-map-wrap`
  // with the page itself not scrollable, so a pick near the bottom of the map left
  // its last items unreachable.
  //
  // The clipper is `.sw-map-wrap` — the menu's own offsetParent (`position:
  // absolute; inset: 0; overflow: hidden`), which is both what `top` is relative to
  // and what hides anything past its edge. Clamping against `window.innerHeight`
  // instead does NOT work while looking as if it does, because the two edges are
  // nowhere near each other at ≥1024: the journal row (`grid-template-rows: 1fr
  // 180px`) plus gap and padding put the map box's bottom ~200 px above the
  // viewport's, and the shell header + the card's own head take ~100 px off its top.
  // Measured live at 1600×950 (sofer, sector 1) with the viewport clamp in place:
  // map box 103…749 against a 950-tall viewport; the lowest gate pick (py=587) ran
  // to 904, which is 46 px SHORT of the viewport — so the clamp computed a 0 px
  // shift — and 155 px PAST the map box, leaving six of the menu's seven items
  // clipped, with elementFromPoint on each returning the journal or the navigation
  // panel behind it. Worst of 29 picks: a station menu 163 px past the box, shifted
  // by 1 px. Against the box the same pick shifts 163 px and ends 8 px inside it.
  //
  // The drawer regime (≤1023.98, journal as a bottom sheet) is the one the viewport
  // clamp was checked in, and even there the two edges only nearly coincide: at
  // 900×700 the box ends at 689 against a 700 viewport, so 28 of 29 picks still had
  // their last item 3 px past the box.
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

  // Clamp into the clipper once the real height is known. Only ever pulls the menu
  // UP, and never above the map box's own top edge, so a pick with room below keeps
  // the plain (px+8, py+8) anchor it always had.
  //
  // Both measurements are independent of the shift already applied — the menu's own
  // offsetHeight and the clipper's clientHeight — so nothing has to be un-done
  // before measuring, and the result can be computed OUTSIDE the setState updater.
  // (The previous version read the DOM inside the updater to subtract its own
  // `prev`, making the reducer impure — and StrictMode calls a reducer twice, which
  // doubled the correction: 329 px of shift applied for the 165 px it computed at
  // 900×700, leaving the menu floating a menu's height away from its own anchor.)
  //
  // ResizeObserver, not the dependency list alone, because the height can change
  // while px/py/target hold still: a refused command mounts `.sw-menu__error` under
  // the items, which is exactly when the bottom item matters.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const clipper = el.offsetParent; // .sw-map-wrap — positioned + overflow:hidden
      if (!clipper) return;
      const top = py + menuOffset;
      const overflow = top + el.offsetHeight + menuGutter - clipper.clientHeight;
      setShiftUp(Math.max(0, Math.min(overflow, top)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [px, py, target]);

  return (
    <div
      ref={ref}
      className="sw-canvas-menu"
      style={{ left: px + menuOffset, top: py + menuOffset - shiftUp }}
    >
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
