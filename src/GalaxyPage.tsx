import { useLocation } from 'react-router-dom';
import { GalaxyMap } from './GalaxyMap';
import { useGameContext } from './gameContext';

export function GalaxyPage() {
  const { ownShip, races } = useGameContext();
  const location = useLocation();
  // jumpMode (TASK-129): CombatHUD's «⚡ Прыжок» navigates here carrying the
  // subject ship id in router-state. We honour it only when it matches the
  // current own ship, so a stale/foreign state (or a page reload, which drops
  // router-state entirely) falls back to the ordinary set-course map.
  const jumpShipID = (location.state as { jumpShipID?: number } | null)?.jumpShipID;
  const jumpMode = jumpShipID != null && jumpShipID === ownShip?.id;
  return (
    <section className="sw-galaxy-page">
      <GalaxyMap
        currentSectorID={ownShip?.sectorID ?? 0}
        ownShipID={ownShip?.id ?? 0}
        races={races}
        jumpMode={jumpMode}
      />
    </section>
  );
}
