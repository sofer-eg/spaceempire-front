import { GalaxyMap } from './GalaxyMap';
import { useGameContext } from './gameContext';

export function GalaxyPage() {
  const { ownShip, races } = useGameContext();
  return (
    <section className="sw-galaxy-page">
      <GalaxyMap
        currentSectorID={ownShip?.sectorID ?? 0}
        ownShipID={ownShip?.id ?? 0}
        races={races}
      />
    </section>
  );
}
