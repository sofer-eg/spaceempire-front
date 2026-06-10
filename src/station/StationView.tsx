import { useState } from 'react';
import { EntityKind, claimStation, getShipAtShipyard } from '../api';
import { useGameContext, useStation } from '../gameContext';
import { CargoView } from './CargoView';
import { MarketView } from './MarketView';
import { AuctionView } from './AuctionView';
import { InsuranceView } from './InsuranceView';
import { ShipyardView } from './ShipyardView';
import { HangarView } from './HangarView';

// Tab id type — listed here so cargoTabEnabled / marketTabEnabled helpers
// can reference it without import gymnastics.
type Tab = 'market' | 'cargo' | 'auction' | 'insurance' | 'shipyard' | 'hangar';

// StationView is the full-center view rendered while ownShip.docked != null.
// Replaces the bare DockPanel that phase 3.2 shipped — adds market, cargo
// and auction tabs and exposes Undock from the header.
export function StationView() {
  const { ownShip, logins, refreshPlayer } = useGameContext();
  const station = useStation();
  // A shipyard has no market/cargo — default to its «Верфь» tab so docking
  // there lands on something useful instead of an empty market.
  const [tab, setTab] = useState<Tab>(() =>
    station?.ref.kind === EntityKind.Shipyard ? 'shipyard' : 'market',
  );
  // marketReload bumps on the «Обновить» button (in the tab bar) and is passed
  // to MarketView as a reload signal. Undock now lives only in the ship HUD.
  const [marketReload, setMarketReload] = useState(0);
  const [claimMsg, setClaimMsg] = useState<string>('');

  if (!ownShip || !station) {
    // Should not happen — SectorView only renders StationView when both
    // are present. The guard keeps TypeScript narrowing happy.
    return null;
  }

  // Claim is offered for an NPC-owned (unowned) plain station while docked
  // (phase 8.7). The live owner display only refreshes on reconnect (the
  // sector worker keeps the static's old owner in RAM — see 8.5/8.7 notes).
  const claimable = station.ref.kind === EntityKind.Station && !station.ownerID;
  const onClaim = async () => {
    setClaimMsg('');
    try {
      await claimStation(station.ref.id);
      void refreshPlayer();
      setClaimMsg('Станция куплена — арендные обязательства начислены.');
    } catch (err) {
      setClaimMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // A spacesuit pilot docked at a shipyard can exchange the suit for a fresh
  // starter ship (phase 10.2). Same handoff-free flow as claim.
  const canGetShip = ownShip.isSpacesuit === true && station.ref.kind === EntityKind.Shipyard;
  const onGetShip = async () => {
    setClaimMsg('');
    try {
      await getShipAtShipyard(station.ref.id);
      void refreshPlayer();
      setClaimMsg('Получен новый корабль.');
    } catch (err) {
      setClaimMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const marketEnabled =
    station.ref.kind === EntityKind.Station ||
    station.ref.kind === EntityKind.TradeStation ||
    station.ref.kind === EntityKind.Pirbase;
  const cargoEnabled =
    station.ref.kind === EntityKind.Station ||
    station.ref.kind === EntityKind.TradeStation;
  // The shipyard buy/outfit tab is shown only when docked at a shipyard.
  const isShipyard = station.ref.kind === EntityKind.Shipyard;
  // Auction is always available — lots are global, not station-bound.

  const ownerLabel = station.ownerID
    ? logins.get(station.ownerID) ?? `#${station.ownerID}`
    : 'NPC';

  return (
    <div className="sw-panel sw-station">
      <div className="sw-panel-head">
        <span className="title">{station.label}</span>
        <div className="sw-row" style={{ gap: 6 }}>
          <span className="sw-chip dot good">DOCKED</span>
          <span className="sw-chip">владелец · {ownerLabel}</span>
          {claimable && (
            <button type="button" className="sw-btn" onClick={() => void onClaim()} title="Купить эту станцию">
              Купить станцию
            </button>
          )}
          {canGetShip && (
            <button
              type="button"
              className="sw-btn"
              onClick={() => void onGetShip()}
              title="Получить новый корабль вместо скафандра"
            >
              Получить новый корабль
            </button>
          )}
        </div>
      </div>
      {claimMsg && (
        <div className="sw-form__status" style={{ padding: '6px 12px' }}>
          {claimMsg}
        </div>
      )}
      <div className="sw-station__tabs">
        {isShipyard && (
          <button
            type="button"
            className="sw-btn"
            data-active={tab === 'shipyard' ? 'true' : undefined}
            onClick={() => setTab('shipyard')}
          >
            Верфь
          </button>
        )}
        <button
          type="button"
          className="sw-btn"
          data-active={tab === 'market' ? 'true' : undefined}
          onClick={() => setTab('market')}
          disabled={!marketEnabled}
          title={marketEnabled ? undefined : 'Здесь не торгуют'}
        >
          Маркет
        </button>
        <button
          type="button"
          className="sw-btn"
          data-active={tab === 'cargo' ? 'true' : undefined}
          onClick={() => setTab('cargo')}
          disabled={!cargoEnabled}
          title={cargoEnabled ? undefined : 'Нет общего трюма'}
        >
          Трюм
        </button>
        <button
          type="button"
          className="sw-btn"
          data-active={tab === 'auction' ? 'true' : undefined}
          onClick={() => setTab('auction')}
        >
          Аукцион
        </button>
        <button
          type="button"
          className="sw-btn"
          data-active={tab === 'insurance' ? 'true' : undefined}
          onClick={() => setTab('insurance')}
        >
          Страховка
        </button>
        <button
          type="button"
          className="sw-btn"
          data-active={tab === 'hangar' ? 'true' : undefined}
          onClick={() => setTab('hangar')}
          title="Корабли, пристыкованные к этой станции"
        >
          Ангар
        </button>
        <div className="sw-spacer" />
        {tab === 'market' && marketEnabled && (
          <button
            type="button"
            className="sw-btn"
            onClick={() => setMarketReload((n) => n + 1)}
            title="Обновить рынок"
          >
            Обновить
          </button>
        )}
      </div>
      <div className="sw-station__body">
        {tab === 'shipyard' && isShipyard && <ShipyardView shipyardID={station.ref.id} />}
        {tab === 'market' && marketEnabled && (
          <MarketView station={station.ref} shipID={ownShip.id} reloadSignal={marketReload} />
        )}
        {tab === 'cargo' && cargoEnabled && (
          <CargoView station={station.ref} shipID={ownShip.id} />
        )}
        {tab === 'auction' && (
          <AuctionView station={station.ref} shipID={ownShip.id} />
        )}
        {tab === 'insurance' && <InsuranceView shipID={ownShip.id} />}
        {tab === 'hangar' && <HangarView station={station.ref} />}
        {tab === 'market' && !marketEnabled && (
          <EmptyTab text="На этом объекте нет рынка." />
        )}
        {tab === 'cargo' && !cargoEnabled && (
          <EmptyTab text="У этого объекта нет общего трюма." />
        )}
      </div>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="sw-station__empty">
      <span>{text}</span>
    </div>
  );
}
