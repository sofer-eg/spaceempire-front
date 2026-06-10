import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  EntityKind,
  fetchAuctionLots,
  fetchMyAuctionLots,
  fetchCargo,
  sendAuctionBid,
  sendAuctionCreate,
  type AuctionLot,
  type CargoItem,
  type EntityRef,
} from '../api';
import { goodsName, useGameContext, usePlayer } from '../gameContext';
import { emitLog } from '../eventBus';

type Props = {
  station: EntityRef;
  shipID: number;
};

// AuctionView lists every active lot and lets the player place a bid or
// create a new lot from the docked ship's hold. Lots are global (not
// station-bound) but live behind the StationView for now per phase 3.8
// scope ("Только как вкладка в StationView").
export function AuctionView({ station, shipID }: Props) {
  const { goods } = useGameContext();
  const { player, refreshPlayer } = usePlayer();
  const ship = useMemo<EntityRef>(() => ({ kind: EntityKind.Ship, id: shipID }), [shipID]);

  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [myLots, setMyLots] = useState<AuctionLot[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string>('');
  const [bidByLot, setBidByLot] = useState<Record<number, number>>({});
  const [busyLot, setBusyLot] = useState<number | null>(null);
  const [shipCargo, setShipCargo] = useState<CargoItem[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((n) => n + 1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, mine, inv] = await Promise.all([
          fetchAuctionLots(),
          fetchMyAuctionLots(),
          fetchCargo(ship),
        ]);
        if (cancelled) return;
        setLots(list);
        setMyLots(mine);
        setShipCargo(inv.items);
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
  }, [ship, reloadKey]);

  const friendlyError = (err: unknown) => {
    if (err instanceof ApiError) return err.message.replace(/^[A-Z]+ \/api[^:]+: /, '');
    if (err instanceof Error) return err.message;
    return String(err);
  };

  const onBid = async (lot: AuctionLot) => {
    const amount = bidByLot[lot.id] ?? lot.currentPrice + 1;
    setBusyLot(lot.id);
    try {
      await sendAuctionBid(lot.id, shipID, amount);
      emitLog({ category: 'trade', kind: 'good', message: `Ставка ${amount} cr · ${goodsName(goods, lot.goodsTypeID)}` });
      await refreshPlayer();
      reload();
    } catch (err) {
      emitLog({
        category: 'trade',
        kind: 'danger',
        message: `Ставка на лот #${lot.id} (${goodsName(goods, lot.goodsTypeID)}): ${friendlyError(err)}`,
      });
    } finally {
      setBusyLot(null);
    }
  };

  if (loadStatus === 'loading') {
    return <div className="sw-station__loader">Загрузка аукциона…</div>;
  }
  if (loadStatus === 'error') {
    return (
      <div className="sw-station__error">
        Не удалось загрузить аукцион: {loadError}
        <button type="button" className="sw-btn" onClick={() => reload()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="sw-auction">
      <div className="sw-row" style={{ justifyContent: 'space-between', padding: '0 12px 6px' }}>
        <span className="sw-chip">
          Кошелёк · {player ? player.cash.toLocaleString('ru-RU') : '—'} cr
        </span>
        <button type="button" className="sw-btn ghost" onClick={() => reload()}>
          Обновить
        </button>
      </div>

      {lots.length === 0 ? (
        <div className="sw-station__empty">Нет активных лотов.</div>
      ) : (
        <table className="sw-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Товар</th>
              <th>Кол-во</th>
              <th>Цена</th>
              <th>Лидер</th>
              <th>До конца</th>
              <th>Ставка</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const own = player && lot.sellerID === player.playerID;
              const ttl = formatTtl(lot.endsAt);
              const myBid = bidByLot[lot.id] ?? lot.currentPrice + 1;
              return (
                <tr key={lot.id}>
                  <td className="sw-mono">#{lot.id}</td>
                  <td>{goodsName(goods, lot.goodsTypeID)}</td>
                  <td className="sw-mono">{lot.quantity}</td>
                  <td className="sw-mono">{lot.currentPrice.toLocaleString('ru-RU')}</td>
                  <td className="sw-mono">{lot.currentBidderID ?? '—'}</td>
                  <td className="sw-mono">{ttl}</td>
                  <td>
                    <input
                      type="number"
                      min={lot.currentPrice + 1}
                      value={myBid}
                      onChange={(e) =>
                        setBidByLot((prev) => ({
                          ...prev,
                          [lot.id]: Math.max(lot.currentPrice + 1, Number(e.target.value)),
                        }))
                      }
                      className="sw-input"
                      style={{ width: 90 }}
                      disabled={Boolean(own)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="sw-btn"
                      disabled={Boolean(own) || busyLot === lot.id}
                      onClick={() => void onBid(lot)}
                    >
                      Ставка
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {myLots.length > 0 && (
        <div className="sw-clan__section">
          <div className="sw-clan__subhead">Мои лоты и ставки</div>
          <table className="sw-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Товар</th>
                <th>Кол-во</th>
                <th>Цена</th>
                <th>Роль</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {myLots.map((lot) => (
                <tr key={lot.id}>
                  <td className="sw-mono">#{lot.id}</td>
                  <td>{goodsName(goods, lot.goodsTypeID)}</td>
                  <td className="sw-mono">{lot.quantity}</td>
                  <td className="sw-mono">{lot.currentPrice.toLocaleString('ru-RU')}</td>
                  <td>{player && lot.sellerID === player.playerID ? 'продавец' : 'ставка'}</td>
                  <td>{auctionStatusLabel(lot.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateLotForm
        source={ship}
        ship={ship}
        shipCargo={shipCargo}
        onCreated={() => {
          void reload();
          void refreshPlayer();
        }}
      />
      <div style={{ padding: '4px 12px', color: 'var(--ink-mute)', fontSize: 11 }}>
        Лот выставляется со склада корабля. После создания груз списывается;
        при отсутствии ставок к концу аукциона возвращается обратно (при
        наличии места). Источник по умолчанию — корабль; стыковочный объект:{' '}
        {station.kind}#{station.id}.
      </div>
    </div>
  );
}

type CreateProps = {
  source: EntityRef;
  ship: EntityRef;
  shipCargo: CargoItem[];
  onCreated: () => void;
};

function CreateLotForm({ source, shipCargo, onCreated }: CreateProps) {
  const { goods } = useGameContext();
  // typeID is null until the user explicitly picks one. We resolve the
  // effective selection (typeID ?? first-in-cargo) inside render so we
  // never have to write a setter from inside an effect.
  const [typeID, setTypeID] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [startPrice, setStartPrice] = useState<number>(100);
  const [durationMin, setDurationMin] = useState<number>(5);
  const [status, setStatus] = useState<'idle' | 'pending' | 'ok'>('idle');

  const cargoTypes = useMemo(() => {
    return shipCargo.map((it) => ({
      typeID: it.typeID,
      name: goodsName(goods, it.typeID),
      quantity: it.quantity,
    }));
  }, [shipCargo, goods]);

  const effectiveTypeID = typeID ?? cargoTypes[0]?.typeID ?? null;
  const selected = cargoTypes.find((c) => c.typeID === effectiveTypeID);
  const max = selected?.quantity ?? 0;

  const friendlyError = (err: unknown) => {
    if (err instanceof ApiError) return err.message.replace(/^[A-Z]+ \/api[^:]+: /, '');
    if (err instanceof Error) return err.message;
    return String(err);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || quantity < 1 || quantity > max) return;
    setStatus('pending');
    try {
      await sendAuctionCreate({
        source,
        goodsTypeID: effectiveTypeID!,
        quantity,
        startPrice,
        durationSeconds: Math.max(60, durationMin * 60),
      });
      emitLog({
        category: 'trade',
        kind: 'good',
        message: `Лот: ${quantity} × ${goodsName(goods, effectiveTypeID!)} от ${startPrice} cr`,
      });
      setStatus('ok');
      onCreated();
    } catch (err) {
      setStatus('idle');
      emitLog({
        category: 'trade',
        kind: 'danger',
        message: `Создание лота (${goodsName(goods, effectiveTypeID!)}): ${friendlyError(err)}`,
      });
    }
  };

  if (cargoTypes.length === 0) {
    return (
      <div className="sw-auction__create">
        <span className="title">Создать лот</span>
        <div className="sw-station__empty">В трюме корабля ничего нет.</div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="sw-form sw-auction__create">
      <span className="title">Создать лот</span>
      <label>
        Товар
        <select
          value={effectiveTypeID ?? ''}
          onChange={(e) => {
            const next = Number(e.target.value);
            setTypeID(next);
            const found = cargoTypes.find((c) => c.typeID === next);
            setQuantity(Math.min(1, found?.quantity ?? 1));
          }}
        >
          {cargoTypes.map((c) => (
            <option key={c.typeID} value={c.typeID}>
              {c.name} ({c.quantity})
            </option>
          ))}
        </select>
      </label>
      <label>
        Кол-во
        <input
          type="number"
          min={1}
          max={max}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.min(max, Number(e.target.value))))}
        />
      </label>
      <label>
        Старт. цена
        <input
          type="number"
          min={1}
          value={startPrice}
          onChange={(e) => setStartPrice(Math.max(1, Number(e.target.value)))}
        />
      </label>
      <label>
        Длит. (мин)
        <input
          type="number"
          min={1}
          value={durationMin}
          onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value)))}
        />
      </label>
      <button type="submit" className="sw-btn" disabled={status === 'pending'}>
        Выставить
      </button>
      <div className={`sw-form__status ${status === 'ok' ? 'ok' : ''}`}>
        {status === 'pending' && 'Отправка…'}
        {status === 'ok' && 'Лот создан.'}
      </div>
    </form>
  );
}

// auctionStatusLabel maps the lot status (0 active / 1 closed / 2 cancelled)
// to a Russian label for the "my lots" view.
function auctionStatusLabel(status: number): string {
  switch (status) {
    case 0:
      return 'активен';
    case 1:
      return 'закрыт';
    case 2:
      return 'отменён';
    default:
      return String(status);
  }
}

function formatTtl(endsAt: string): string {
  const ms = Date.parse(endsAt) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return '00:00';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
