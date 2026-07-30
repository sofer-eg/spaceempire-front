import { useEffect, useMemo, useState } from 'react';
import {
  commandErrorText,
  fetchCargo,
  friendlyError,
  sendMoveCargo,
  type CargoInventory,
  type CargoItem,
  type EntityRef,
} from '../api';
import { goodsName, goodsSpace, shipDisplayName, useGameContext } from '../gameContext';
import { emitLog } from '../eventBus';

type Props = {
  station: EntityRef;
  shipID: number;
};

// CargoView shows the ship inventory next to the station inventory and
// lets the player move stacks in either direction. We avoid HTML5 DnD on
// purpose — explicit per-row buttons + qty input is simpler to test and
// covers the same MVP UX the task spec asks for.
export function CargoView({ station, shipID }: Props) {
  const { goods, ships, races } = useGameContext();
  const ship = useMemo<EntityRef>(() => ({ kind: 1, id: shipID }), [shipID]);
  const dockedShip = ships.get(shipID);
  const [shipInv, setShipInv] = useState<CargoInventory | null>(null);
  const [stationInv, setStationInv] = useState<CargoInventory | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [s, st] = await Promise.all([fetchCargo(ship), fetchCargo(station)]);
        if (cancelled) return;
        setShipInv(s);
        setStationInv(st);
        setLoadStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setLoadError(friendlyError(err));
        setLoadStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ship, station, reloadKey]);

  const move = async (from: EntityRef, to: EntityRef, typeID: number, qty: number) => {
    setBusy(true);
    try {
      await sendMoveCargo(from, to, typeID, qty);
      reload();
    } catch (err) {
      emitLog({
        category: 'trade',
        kind: 'danger',
        message: `Перенос ${qty} × ${goodsName(goods, typeID)}: ${commandErrorText(err)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  if (loadStatus === 'loading') {
    return <div className="sw-station__loader">Загрузка трюма…</div>;
  }
  if (loadStatus === 'error' || !shipInv || !stationInv) {
    return (
      <div className="sw-station__error">
        Не удалось загрузить трюм: {loadError}
        <button type="button" className="sw-btn" onClick={() => reload()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="sw-cargo">
      <CargoColumn
        // Named the way the HUD names it instead of by its raw id (TASK-140).
        // Resolved from the shipID prop the inventory is loaded for, not from
        // ownShip: the two agree today only because StationView passes ownShip's
        // id, and a header naming a different ship than the hold below it is the
        // exact defect class this task is about.
        title={dockedShip ? `Трюм · ${shipDisplayName(dockedShip, races)}` : 'Трюм корабля'}
        inv={shipInv}
        action="unload"
        busy={busy}
        onMove={(typeID, qty) => void move(ship, station, typeID, qty)}
        goods={goods}
      />
      <CargoColumn
        title="Склад станции"
        inv={stationInv}
        action="load"
        busy={busy}
        onMove={(typeID, qty) => void move(station, ship, typeID, qty)}
        goods={goods}
      />
    </div>
  );
}

type ColumnProps = {
  title: string;
  inv: CargoInventory;
  action: 'load' | 'unload';
  busy: boolean;
  onMove: (typeID: number, qty: number) => void;
  goods: import('../api').GoodsRow[];
};

function CargoColumn({ title, inv, action, busy, onMove, goods }: ColumnProps) {
  const [qtyByType, setQtyByType] = useState<Record<number, number>>({});
  const qty = (typeID: number) => qtyByType[typeID] ?? 1;
  const setQty = (typeID: number, value: number) =>
    setQtyByType((prev) => ({ ...prev, [typeID]: Math.max(1, Math.floor(value)) }));

  const label = action === 'unload' ? '→ Выгрузить' : '→ Загрузить';

  return (
    <div className="sw-cargo__col">
      <div className="sw-cargo__head">
        <span className="title">{title}</span>
        {/* Grouped like every other figure in the UI: a full hold read
            «249789/50000», which is two 6-digit runs and the one place a player
            checks before buying (TASK-169). The chip is not in a table column,
            so the extra separator costs nothing here. */}
        <span className="sw-chip sw-mono">
          {`${Math.round(inv.used).toLocaleString('ru-RU')}/${Math.round(inv.capacity).toLocaleString('ru-RU')}`}
        </span>
      </div>
      {inv.items.length === 0 ? (
        <div className="sw-station__empty">Пусто.</div>
      ) : (
        // sw-table-scroll: residual overflow scrolls inside the card. On a narrow
        // card .sw-cargo also stops splitting it in half, so each hold table gets
        // the full width instead of ~228px (TASK-134).
        <div className="sw-table-scroll">
          <table className="sw-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Кол-во</th>
                <th>Перенос</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it: CargoItem) => (
                <tr key={it.typeID}>
                  <td>
                    {goodsName(goods, it.typeID)}
                    <span className="sw-chip" style={{ marginLeft: 6 }}>
                      {goodsSpace(goods, it.typeID)} м³
                    </span>
                  </td>
                  <td className="sw-mono">{it.quantity}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={it.quantity}
                      value={Math.min(qty(it.typeID), it.quantity)}
                      onChange={(e) => setQty(it.typeID, Number(e.target.value))}
                      className="sw-input sw-qty"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="sw-btn"
                      disabled={busy}
                      onClick={() => onMove(it.typeID, Math.min(qty(it.typeID), it.quantity))}
                    >
                      {label}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
