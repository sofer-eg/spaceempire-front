import { useEffect, useState } from 'react';
import {
  ApiError,
  EntityKind,
  fetchCargo,
  fetchMarket,
  sendBuy,
  sendSell,
  type CargoInventory,
  type EntityRef,
  type MarketEntry,
  type ProductionInfo,
} from '../api';
import { goodsName, goodsSpace, usePlayer, useGameContext } from '../gameContext';
import { emitLog } from '../eventBus';
import { MarketScanPanel } from './MarketScanPanel';

type Props = {
  station: EntityRef;
  shipID: number;
  // reloadSignal bumps from the StationView «Обновить» button (which lives in
  // the tab bar now). A change re-runs the fetch effect without remounting,
  // so the player's typed quantities survive the refresh.
  reloadSignal?: number;
};

type RowStatus = { kind: 'idle' } | { kind: 'pending' };

// MarketView renders the station's wares as a sortable-ish table and lets
// the docked ship buy or sell each row. Quantity is per-row state so the
// player can type a number once and click Buy/Sell without losing it.
export function MarketView({ station, shipID, reloadSignal }: Props) {
  const { goods } = useGameContext();
  const { player, ownShip, setCash, refreshPlayer } = usePlayer();
  const [items, setItems] = useState<MarketEntry[]>([]);
  // Production-cycle adornment, present only for producing factories
  // (EntityKind.Station with a recipe). remaining drives the local
  // countdown so the chip ticks without re-fetching every second.
  const [production, setProduction] = useState<ProductionInfo | null>(null);
  const [remaining, setRemaining] = useState(0);
  // shipCargo backs the «↑» max-buy / max-sell buttons. We keep the whole
  // inventory (capacity + used + items) because max-buy needs free space
  // in m³ to clamp qty by what physically fits. Updated locally on each
  // trade's ack.moved so the buttons stay accurate without a reload.
  const [shipCargo, setShipCargo] = useState<CargoInventory | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string>('');
  const [qtyByType, setQtyByType] = useState<Record<number, number>>({});
  const [rowStatus, setRowStatus] = useState<Record<number, RowStatus>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [market, cargo] = await Promise.all([
          fetchMarket(station),
          fetchCargo({ kind: EntityKind.Ship, id: shipID }),
        ]);
        if (cancelled) return;
        const prod = market.production ?? null;
        setItems(market.items);
        setProduction(prod);
        // Seed the countdown here (inside the fetch callback) rather than in a
        // separate effect, so we never call setState synchronously in an
        // effect body. The ticking effect below only decrements.
        setRemaining(prod && prod.inProgress ? Math.ceil(prod.secondsRemaining) : 0);
        setShipCargo(cargo);
        setLoadStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoadStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [station, shipID, reloadKey, reloadSignal]);

  // Tick the in-progress production cycle down to 0 once per second (where the
  // chip shows «обработка…» until the next manual refresh reconciles). Seeding
  // happens in the fetch callback above, so this effect body only sets up the
  // interval — no synchronous setState.
  useEffect(() => {
    if (!production || !production.inProgress) return;
    const timer = window.setInterval(() => {
      setRemaining((r) => (r > 1 ? r - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [production]);

  const qty = (typeID: number) => qtyByType[typeID] ?? 1;
  const setQty = (typeID: number, value: number) =>
    setQtyByType((prev) => ({ ...prev, [typeID]: Math.max(1, Math.floor(value)) }));

  // How many units of `typeID` are in the ship's hold right now.
  const cargoQty = (typeID: number) =>
    shipCargo?.items.find((c) => c.typeID === typeID)?.quantity ?? 0;
  // How many units of `typeID` can still fit in the hold by volume.
  const freeUnits = (typeID: number) => {
    if (!shipCargo) return 0;
    const space = goodsSpace(goods, typeID);
    if (space <= 0) return 0;
    return Math.max(0, Math.floor((shipCargo.capacity - shipCargo.used) / space));
  };
  const cash = player?.cash ?? 0;
  // Max units the player can buy: limited by wallet, ship free volume,
  // and what the station has on offer. 0 when the station doesn't sell.
  const maxBuy = (entry: MarketEntry) => {
    if (entry.sellPrice === null || entry.sellPrice <= 0) return 0;
    return Math.max(
      0,
      Math.min(Math.floor(cash / entry.sellPrice), freeUnits(entry.typeID), entry.stock),
    );
  };
  // Max units the player can sell: limited by what's in the hold and by
  // how much the station can still accept. 0 when the station doesn't buy.
  const maxSell = (entry: MarketEntry) => {
    if (entry.buyPrice === null) return 0;
    return Math.max(
      0,
      Math.min(cargoQty(entry.typeID), entry.maxStock - entry.stock),
    );
  };
  // Apply ack.moved locally: bump the per-type quantity and update used
  // volume so the next max-buy / max-sell calculation matches reality.
  const patchCargo = (typeID: number, delta: number) =>
    setShipCargo((prev) => {
      if (!prev) return prev;
      const space = goodsSpace(goods, typeID);
      const existing = prev.items.find((c) => c.typeID === typeID);
      const nextQty = Math.max(0, (existing?.quantity ?? 0) + delta);
      let nextItems;
      if (existing) {
        nextItems =
          nextQty === 0
            ? prev.items.filter((c) => c.typeID !== typeID)
            : prev.items.map((c) =>
                c.typeID === typeID ? { ...c, quantity: nextQty } : c,
              );
      } else if (delta > 0) {
        nextItems = [...prev.items, { typeID, quantity: nextQty }];
      } else {
        nextItems = prev.items;
      }
      return {
        ...prev,
        used: Math.max(0, prev.used + delta * space),
        items: nextItems,
      };
    });

  const friendlyError = (err: unknown) => {
    if (err instanceof ApiError) return err.message.replace(/^[A-Z]+ \/api[^:]+: /, '');
    if (err instanceof Error) return err.message;
    return String(err);
  };

  const onBuy = async (entry: MarketEntry) => {
    const typeID = entry.typeID;
    const want = qty(typeID);
    setRowStatus((p) => ({ ...p, [typeID]: { kind: 'pending' } }));
    try {
      const ack = await sendBuy(shipID, station, typeID, want);
      setCash(ack.newCash);
      // Patch the row's stock optimistically — saves a full refetch on a
      // typical trade. The next user-triggered reload reconciles drift.
      setItems((prev) =>
        prev.map((it) => (it.typeID === typeID ? { ...it, stock: ack.newStock } : it)),
      );
      patchCargo(typeID, ack.moved);
      emitLog({ category: 'trade', kind: 'good', message: `Куплено ${ack.moved} × ${goodsName(goods, typeID)}` });
      void refreshPlayer();
      setRowStatus((p) => ({ ...p, [typeID]: { kind: 'idle' } }));
    } catch (err) {
      setRowStatus((p) => ({ ...p, [typeID]: { kind: 'idle' } }));
      emitLog({
        category: 'trade',
        kind: 'danger',
        message: `Покупка ${want} × ${goodsName(goods, typeID)}: ${friendlyError(err)}`,
      });
    }
  };

  const onSell = async (entry: MarketEntry) => {
    const typeID = entry.typeID;
    const want = qty(typeID);
    setRowStatus((p) => ({ ...p, [typeID]: { kind: 'pending' } }));
    try {
      const ack = await sendSell(shipID, station, typeID, want);
      setCash(ack.newCash);
      setItems((prev) =>
        prev.map((it) => (it.typeID === typeID ? { ...it, stock: ack.newStock } : it)),
      );
      patchCargo(typeID, -ack.moved);
      emitLog({ category: 'trade', kind: 'good', message: `Продано ${ack.moved} × ${goodsName(goods, typeID)}` });
      void refreshPlayer();
      setRowStatus((p) => ({ ...p, [typeID]: { kind: 'idle' } }));
    } catch (err) {
      setRowStatus((p) => ({ ...p, [typeID]: { kind: 'idle' } }));
      emitLog({
        category: 'trade',
        kind: 'danger',
        message: `Продажа ${want} × ${goodsName(goods, typeID)}: ${friendlyError(err)}`,
      });
    }
  };

  if (loadStatus === 'loading') {
    return <div className="sw-station__loader">Загрузка рынка…</div>;
  }
  if (loadStatus === 'error') {
    return (
      <div className="sw-station__error">
        Не удалось загрузить рынок: {loadError}
        <button type="button" className="sw-btn" onClick={() => reload()}>
          Повторить
        </button>
      </div>
    );
  }

  // The sector price-scanner block is shown only when the active ship carries a
  // trade_up module (phase 10.3.12). Detail (tier / prices / stock) is gated by
  // the module level server-side; here we just gate the block's presence. It
  // scans the whole sector, so it is independent of the docked station's own
  // market — it must still render when this station does not trade.
  const hasTradeScanner = (ownShip?.equipment ?? []).some((e) => e.type === 'trade_up');

  if (items.length === 0) {
    return (
      <div className="sw-market">
        <div className="sw-station__empty">Станция не торгует.</div>
        {hasTradeScanner && <MarketScanPanel reloadSignal={reloadSignal} />}
      </div>
    );
  }

  // On a producing factory the inputs and the output never overlap, so we
  // split the single market into «Продукция» (what the factory sells →
  // Купить) and «Сырьё» (what it buys → Продать). Trade stations / pirbases
  // keep the unified list because there a good can be both bought and sold.
  const isFactory = station.kind === EntityKind.Station;
  const products = items.filter((it) => it.sellPrice !== null);
  const materials = items.filter((it) => it.buyPrice !== null);

  const renderRow = (it: MarketEntry, mode: 'buy' | 'sell' | 'both') => {
    const status = rowStatus[it.typeID] ?? { kind: 'idle' };
    const canBuy = it.sellPrice !== null && it.stock > 0;
    const canSell = it.buyPrice !== null && it.stock < it.maxStock;
    const showBuy = mode === 'buy' || mode === 'both';
    const showSell = mode === 'sell' || mode === 'both';
    return (
      <tr key={it.typeID}>
        <td>{goodsName(goods, it.typeID)}</td>
        <td className="sw-mono">{it.sellPrice ?? '—'}</td>
        <td className="sw-mono">{it.buyPrice ?? '—'}</td>
        <td className="sw-mono">
          {it.stock}/{it.maxStock}
        </td>
        <td>
          <input
            type="number"
            min={1}
            value={qty(it.typeID)}
            onChange={(e) => setQty(it.typeID, Number(e.target.value))}
            className="sw-input"
            style={{ width: 70 }}
          />
        </td>
        <td>
          <div className="sw-row" style={{ gap: 6 }}>
            {showBuy && (
              <>
                <button
                  type="button"
                  className="sw-btn ghost"
                  disabled={maxBuy(it) === 0 || status.kind === 'pending'}
                  title={`Максимум для покупки: ${maxBuy(it)} (кошелёк ${cash}, свободно в трюме ${freeUnits(it.typeID)}, на станции ${it.stock})`}
                  onClick={() => setQty(it.typeID, maxBuy(it))}
                  aria-label="Максимум для покупки"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="sw-btn"
                  disabled={!canBuy || status.kind === 'pending'}
                  onClick={() => void onBuy(it)}
                >
                  Купить
                </button>
              </>
            )}
            {showSell && (
              <>
                <button
                  type="button"
                  className="sw-btn"
                  disabled={!canSell || status.kind === 'pending'}
                  onClick={() => void onSell(it)}
                >
                  Продать
                </button>
                <button
                  type="button"
                  className="sw-btn ghost"
                  disabled={maxSell(it) === 0 || status.kind === 'pending'}
                  title={`Максимум для продажи: ${maxSell(it)} (трюм ${cargoQty(it.typeID)}, свободно у станции ${it.maxStock - it.stock})`}
                  onClick={() => setQty(it.typeID, maxSell(it))}
                  aria-label="Максимум для продажи"
                >
                  ↑
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const renderTable = (list: MarketEntry[], mode: 'buy' | 'sell' | 'both') => (
    <table className="sw-table">
      <thead>
        <tr>
          <th>Товар</th>
          <th>Покупка</th>
          <th>Продажа</th>
          <th>Запас</th>
          <th>Кол-во</th>
          <th>Действие</th>
        </tr>
      </thead>
      <tbody>{list.map((it) => renderRow(it, mode))}</tbody>
    </table>
  );

  // The production countdown sits to the right of the «Продукция» heading.
  // While a cycle runs it shows the time left (M:SS); idle factories show a
  // muted «ожидание». null when the station has no recipe.
  const cycleTimer = () => {
    if (!production) return null;
    let label: string;
    if (production.inProgress) {
      label = remaining > 0 ? formatMMSS(remaining) : 'обработка…';
    } else {
      label = 'ожидание';
    }
    return (
      <span className="sw-market__timer" title="Осталось до окончания цикла производства">
        ⏱ {label}
      </span>
    );
  };

  return (
    <div className="sw-market">
      {isFactory ? (
        <>
          {products.length > 0 && (
            <section className="sw-market__section">
              <div className="sw-market__subhead">
                <span>Продукция</span>
                {cycleTimer()}
              </div>
              {renderTable(products, 'buy')}
            </section>
          )}
          {materials.length > 0 && (
            <section className="sw-market__section">
              <div className="sw-market__subhead">
                <span>Сырьё</span>
              </div>
              {renderTable(materials, 'sell')}
            </section>
          )}
        </>
      ) : (
        renderTable(items, 'both')
      )}
      {hasTradeScanner && <MarketScanPanel reloadSignal={reloadSignal} />}
    </div>
  );
}

// formatMMSS renders a second count as M:SS for the production-cycle chip.
function formatMMSS(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
