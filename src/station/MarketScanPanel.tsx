import { useEffect, useState } from 'react';
import { fetchMarketScan, type ScanGood, type ScanResponse } from '../api';
import { goodsName, staticTypeLabel, useGameContext } from '../gameContext';

// MarketScanPanel renders the trade_up sector price-scanner: a товар × станция
// matrix of every tradeable station in the player's current sector. Detail is
// gated by the module level returned in the scan: level 1 shows only a
// high/medium/low tier badge, level 2 adds the real prices, level 3 adds the
// on-hand stock. The whole panel is mounted only when the active ship carries a
// trade_up module — see MarketView.

type Props = {
  // reloadSignal bumps from the StationView «Обновить» button so the scan
  // refreshes alongside the docked station's market.
  reloadSignal?: number;
};

const TIER: Record<ScanGood['priceLevel'], { dot: string; label: string }> = {
  high: { dot: '🔴', label: 'высокая' },
  medium: { dot: '🟡', label: 'средняя' },
  low: { dot: '🟢', label: 'низкая' },
};

export function MarketScanPanel({ reloadSignal }: Props) {
  const { goods, stationTypes } = useGameContext();
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchMarketScan();
        if (cancelled) return;
        setScan(data);
        setStatus('ok');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadSignal]);

  if (status === 'loading') {
    return <div className="sw-station__loader">Сканирование сектора…</div>;
  }
  if (status === 'error') {
    return <div className="sw-station__error">Сканер недоступен: {error}</div>;
  }
  if (!scan || scan.stations.length === 0) {
    return <div className="sw-station__empty">В секторе нет торговых станций для сканирования.</div>;
  }

  const level = scan.level;
  // Build the union of goods across all scanned stations so every row is a
  // good and every column a station — a сравнительная матрица цен.
  const goodIDs = Array.from(
    new Set(scan.stations.flatMap((st) => st.goods.map((g) => g.typeID))),
  );
  // Per-station lookup: typeID → ScanGood, so the cell render is O(1). label
  // resolves a production station's station_types name from its catalog id (so
  // several factories in one sector are distinct); trade-stations / pirbases
  // fall back to their generic per-kind name.
  const byStation = scan.stations.map((st) => {
    const map = new Map<number, ScanGood>();
    for (const g of st.goods) map.set(g.typeID, g);
    const label = staticTypeLabel(st.owner.kind, st.stationType, stationTypes) || st.name;
    return { station: st, label, map };
  });

  const renderCell = (g: ScanGood | undefined) => {
    if (!g) return <span className="sw-muted">—</span>;
    const tier = TIER[g.priceLevel];
    return (
      <div className="sw-mscan__cell" title={`Цена: ${tier.label}`}>
        <span className="sw-mscan__tier">
          {tier.dot}
          {level >= 2 && (
            <span className="sw-mono sw-mscan__price">
              {g.sellPrice > 0 ? g.sellPrice : g.buyPrice > 0 ? g.buyPrice : '—'}
            </span>
          )}
        </span>
        {level >= 3 && <span className="sw-mono sw-muted sw-mscan__stock">×{g.stock}</span>}
      </div>
    );
  };

  return (
    <section className="sw-market__section sw-mscan">
      <div className="sw-market__subhead">
        <span>Сканер рынка сектора · ур. {level}</span>
        <span className="sw-muted sw-mscan__hint">
          {level === 1 && 'уровень цены'}
          {level === 2 && 'уровень цены + реальные цены'}
          {level >= 3 && 'уровень цены + цены + количество'}
        </span>
      </div>
      <div className="sw-mscan__legend">
        {TIER.high.dot} высокая&nbsp;&nbsp;{TIER.medium.dot} средняя&nbsp;&nbsp;{TIER.low.dot} низкая
      </div>
      <table className="sw-table sw-mscan__table">
        <thead>
          <tr>
            <th>Товар</th>
            {byStation.map(({ station, label }) => (
              <th key={`${station.owner.kind}:${station.owner.id}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {goodIDs.map((typeID) => (
            <tr key={typeID}>
              <td>{goodsName(goods, typeID)}</td>
              {byStation.map(({ station, map }) => (
                <td key={`${station.owner.kind}:${station.owner.id}`}>{renderCell(map.get(typeID))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
