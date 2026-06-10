import { useEffect, useMemo, useState } from 'react';
import {
  buyShip,
  fetchEquipment,
  fetchShipClasses,
  installEquipment,
  uninstallEquipment,
  type Equipment,
  type InstalledEquipment,
  type ShipClass,
} from '../api';
import { usePlayer } from '../gameContext';
import { emitLog } from '../eventBus';

type Props = {
  shipyardID: number;
};

// ShipyardView is the «Верфь» tab (phase 10.14): buy a class ship for credits
// and outfit the active ship with ct_updates modules. The bought ship spawns
// docked here and joins the player's fleet — there is no active-ship switch
// yet, so the player keeps flying their current ship (which is what the outfit
// section targets).
export function ShipyardView({ shipyardID }: Props) {
  const { player, ownShip, setCash, refreshPlayer } = usePlayer();
  const [classes, setClasses] = useState<ShipClass[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  // installed mirrors ownShip.equipment for snappy feedback: the WS patch only
  // reflects an install/remove on the next tick, so we apply the ack's list
  // immediately and re-sync whenever the authoritative ship state changes.
  const [installed, setInstalled] = useState<InstalledEquipment[]>(ownShip?.equipment ?? []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cls, eq] = await Promise.all([fetchShipClasses(), fetchEquipment()]);
        if (cancelled) return;
        setClasses(cls);
        setEquipment(eq);
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
  }, []);

  // Reconcile the local fit with the authoritative ship state (WS patches).
  // An install/uninstall ack is fresher than the WS snapshot, which only
  // reflects the change a tick later — so after an ack we mark pendingSig and
  // ignore WS until it catches up to that exact fit, preventing a stale
  // snapshot from briefly reverting an optimistic change. Done during render
  // (the React "adjust state when a prop changes" pattern), not in an effect.
  const [pendingSig, setPendingSig] = useState<string | null>(null);
  const ownSig = equipSig(ownShip?.equipment);
  const [wsSig, setWsSig] = useState(ownSig);
  if (ownSig !== wsSig) {
    setWsSig(ownSig);
    if (pendingSig === null) {
      setInstalled(ownShip?.equipment ?? []);
    } else if (pendingSig === ownSig) {
      setPendingSig(null); // WS confirmed our optimistic change
      setInstalled(ownShip?.equipment ?? []);
    }
    // else: WS still pre-change relative to our pending fit — keep the optimistic one.
  }

  const cash = player?.cash ?? 0;

  // The active ship's class drives which equipment rows apply.
  const ownClass = useMemo(
    () => classes.find((c) => c.id === ownShip?.shipClassID),
    [classes, ownShip?.shipClassID],
  );

  // Buy list: the ships this shipyard's-race player can build, cheapest first.
  // Filtered to the player's race when known (you build your own faction's
  // hulls); falls back to the whole catalog for a raceless player.
  const buyList = useMemo(() => {
    const race = ownShip?.race ?? 0;
    // basePrice > 0 drops non-purchasable special/unique hulls (price 0 in the
    // catalog) so the list only shows ships you actually buy for credits.
    const list = (race > 0 ? classes.filter((c) => c.race === race) : classes).filter(
      (c) => c.basePrice > 0,
    );
    return [...list].sort((a, b) => a.basePrice - b.basePrice);
  }, [classes, ownShip?.race]);

  if (!ownShip) return null;
  if (loadStatus === 'loading') {
    return <div className="sw-station__loader">Загрузка каталога верфи…</div>;
  }
  if (loadStatus === 'error') {
    return <div className="sw-station__error">Не удалось загрузить каталог: {loadError}</div>;
  }

  const onBuy = async (cls: ShipClass) => {
    setBusy(true);
    try {
      const ack = await buyShip(shipyardID, cls.id);
      setCash(ack.cash);
      void refreshPlayer();
      emitLog({
        category: 'system',
        kind: 'good',
        message: `Куплен корабль «${cls.name}» (#${ack.shipID}) — пристыкован к верфи`,
      });
    } catch (err) {
      emitLog({
        category: 'system',
        kind: 'danger',
        message: `Покупка «${cls.name}»: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const onInstall = async (eq: Equipment, level: number) => {
    setBusy(true);
    try {
      const ack = await installEquipment(shipyardID, ownShip.id, eq.id, level);
      setCash(ack.cash);
      setInstalled(ack.equipment);
      setPendingSig(equipSig(ack.equipment));
      void refreshPlayer();
      emitLog({ category: 'system', kind: 'good', message: `Установлено: ${eq.description} (ур. ${level})` });
    } catch (err) {
      emitLog({
        category: 'system',
        kind: 'danger',
        message: `Установка «${eq.description}»: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const onUninstall = async (m: InstalledEquipment) => {
    setBusy(true);
    try {
      const ack = await uninstallEquipment(shipyardID, ownShip.id, m.equipmentID);
      setCash(ack.cash);
      setInstalled(ack.equipment);
      setPendingSig(equipSig(ack.equipment));
      void refreshPlayer();
      emitLog({ category: 'system', kind: 'good', message: `Снято: ${equipName(equipment, m)}` });
    } catch (err) {
      emitLog({
        category: 'system',
        kind: 'danger',
        message: `Снятие модуля: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-shipyard">
      <section className="sw-market__section">
        <div className="sw-market__subhead">
          <span>Покупка корабля</span>
          <span className="sw-chip">кредиты · {cash.toLocaleString('ru-RU')}</span>
        </div>
        <table className="sw-table">
          <thead>
            <tr>
              <th>Класс</th>
              <th>Модель</th>
              <th>Корпус</th>
              <th>Щит</th>
              <th>Цена</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {buyList.map((c) => (
              <tr key={c.id}>
                <td>{c.categoryLabel}</td>
                <td>{c.name}</td>
                <td className="sw-mono">{c.hull.toLocaleString('ru-RU')}</td>
                <td className="sw-mono">{c.shield.toLocaleString('ru-RU')}</td>
                <td className="sw-mono">{c.basePrice.toLocaleString('ru-RU')}</td>
                <td>
                  <button
                    type="button"
                    className="sw-btn"
                    disabled={busy || cash < c.basePrice}
                    title={cash < c.basePrice ? 'Недостаточно кредитов' : undefined}
                    onClick={() => void onBuy(c)}
                  >
                    Купить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <OutfitSection
        ownClass={ownClass}
        equipment={equipment}
        installed={installed}
        cash={cash}
        busy={busy}
        onInstall={onInstall}
        onUninstall={onUninstall}
      />
    </div>
  );
}

type OutfitProps = {
  ownClass: ShipClass | undefined;
  equipment: Equipment[];
  installed: InstalledEquipment[];
  cash: number;
  busy: boolean;
  onInstall: (eq: Equipment, level: number) => void;
  onUninstall: (m: InstalledEquipment) => void;
};

// OutfitSection renders the active ship's current fit and the modules it can
// still install, filtered to its class and race.
function OutfitSection({ ownClass, equipment, installed, cash, busy, onInstall, onUninstall }: OutfitProps) {
  // Per-row chosen level (defaults to 1) for modules with max_level > 1.
  const [levels, setLevels] = useState<Record<number, number>>({});

  if (!ownClass) {
    return (
      <section className="sw-market__section">
        <div className="sw-market__subhead">
          <span>Дооснащение</span>
        </div>
        <div className="sw-station__empty">
          Дооснащение доступно только для корабля с классом (не для скафандра).
        </div>
      </section>
    );
  }

  const installedTypes = new Set(installed.map((m) => m.type));
  // Rows applicable to this ship: its class (or universal class 0), its race
  // (or universal race 0). De-duplicated by type so each module appears once
  // (a race-specific row wins over the universal one).
  const applicable = pickPerType(
    equipment.filter(
      (e) =>
        (e.shipClass === ownClass.class || e.shipClass === 0) &&
        (e.race === 0 || e.race === ownClass.race),
    ),
  );
  const available = applicable.filter((e) => !installedTypes.has(e.type));

  const level = (id: number) => levels[id] ?? 1;
  const installPrice = (e: Equipment, lvl: number) => e.price + lvl * e.pricePerLevel;
  const depMissing = (e: Equipment) =>
    e.dependance !== '' && e.dependance !== 'none' && !installedTypes.has(e.dependance);

  return (
    <section className="sw-market__section">
      <div className="sw-market__subhead">
        <span>Дооснащение · {ownClass.name}</span>
      </div>

      <div className="sw-shipyard__subtitle">Установлено</div>
      {installed.length === 0 ? (
        <div className="sw-station__empty">Оборудование не установлено.</div>
      ) : (
        <table className="sw-table">
          <thead>
            <tr>
              <th>Модуль</th>
              <th>Уровень</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {installed.map((m) => (
              <tr key={m.equipmentID}>
                <td>{equipName(equipment, m)}</td>
                <td className="sw-mono">{m.level}</td>
                <td>
                  <button
                    type="button"
                    className="sw-btn ghost"
                    disabled={busy}
                    onClick={() => onUninstall(m)}
                  >
                    Снять
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="sw-shipyard__subtitle">Доступно</div>
      {available.length === 0 ? (
        <div className="sw-station__empty">Нет доступных модулей для этого класса.</div>
      ) : (
        <table className="sw-table">
          <thead>
            <tr>
              <th>Модуль</th>
              <th>Уровень</th>
              <th>Цена</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {available.map((e) => {
              const lvl = level(e.id);
              const price = installPrice(e, lvl);
              const dep = depMissing(e);
              const tooCheap = cash < price;
              const disabledTitle = dep
                ? `Сначала установите: ${depLabel(equipment, e.dependance)}`
                : tooCheap
                  ? 'Недостаточно кредитов'
                  : undefined;
              return (
                <tr key={e.id}>
                  <td>{e.description}</td>
                  <td>
                    {e.maxLevel > 1 ? (
                      <select
                        className="sw-input"
                        style={{ width: 64 }}
                        value={lvl}
                        onChange={(ev) =>
                          setLevels((p) => ({ ...p, [e.id]: Number(ev.target.value) }))
                        }
                      >
                        {Array.from({ length: e.maxLevel }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="sw-mono">1</span>
                    )}
                  </td>
                  <td className="sw-mono">{price.toLocaleString('ru-RU')}</td>
                  <td>
                    <button
                      type="button"
                      className="sw-btn"
                      disabled={busy || dep || tooCheap}
                      title={disabledTitle}
                      onClick={() => onInstall(e, lvl)}
                    >
                      Установить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// pickPerType keeps one catalog row per module type (the first after the
// caller's class/race filter — a race-specific row sorts before the universal
// one in YAML order, so it wins).
function pickPerType(rows: Equipment[]): Equipment[] {
  const seen = new Set<string>();
  const out: Equipment[] = [];
  for (const r of rows) {
    if (seen.has(r.type)) continue;
    seen.add(r.type);
    out.push(r);
  }
  return out;
}

// equipSig is an order-independent signature of an installed-equipment list,
// used to tell whether the WS-reported fit matches a pending optimistic one.
function equipSig(eq: InstalledEquipment[] | undefined): string {
  return (eq ?? []).map((m) => `${m.equipmentID}:${m.level}`).sort().join(',');
}

// equipName resolves an installed module's human label from the catalog,
// falling back to its type key when the catalog row is missing.
function equipName(catalog: Equipment[], m: InstalledEquipment): string {
  return catalog.find((e) => e.id === m.equipmentID)?.description ?? m.type;
}

// depLabel resolves a dependency type key (e.g. up_accumulator) to a human
// label via the first catalog row of that type.
function depLabel(catalog: Equipment[], type: string): string {
  return catalog.find((e) => e.type === type)?.description ?? type;
}
