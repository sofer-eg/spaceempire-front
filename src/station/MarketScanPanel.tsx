import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchMarketScan, friendlyError, type ScanGood, type ScanResponse } from '../api';
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

// forecastTrend compares the projected price to the current one for the level-4
// arrow + colour class. A rising price (scarcity ahead) is "up"/red; a falling
// one "down"/green.
function forecastTrend(current: number, forecast: number): { arrow: string; cls: string } {
  if (current <= 0 || forecast === current) return { arrow: '→', cls: '' };
  return forecast > current ? { arrow: '↑', cls: 'up' } : { arrow: '↓', cls: 'down' };
}

export function MarketScanPanel({ reloadSignal }: Props) {
  const { goods, stationTypes } = useGameContext();
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

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
        setError(friendlyError(err));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadSignal]);

  // Feed the two lengths the column snapping in App.css needs and CSS cannot
  // measure for itself. Both come off the rendered table, so they follow the
  // compaction switch and any change to the goods list without a second source
  // of truth:
  //   --sw-mscan-frozen  width of the pinned «Товар» column, which is the
  //       longest goods name. It is the offset a snapped column has to clear,
  //       or snapping parks columns underneath the frozen one.
  //   --sw-mscan-tail    trailing room, so that MAX SCROLL is a column boundary
  //       too. Snap positions are clamped into the scroll range, so every one
  //       past the natural end of that range collapses onto it -- and that end
  //       is an arbitrary offset, where a column straddles the frozen edge. The
  //       tail is the distance from there to the NEXT boundary: the whole of
  //       what is needed, and under one column wide by construction (measured
  //       120.8px at a 900px viewport, 10.8px at 1280).
  //       Sizing it so the LAST column reaches the frozen edge instead -- what
  //       this did until the third review round -- satisfies the same boundary
  //       requirement by way of the far end of the matrix, and costs 547.6 /
  //       245.8px of tail, i.e. 547.1 / 245.5px of blank at the far end: 68% of
  //       the card at 900 and 52% at 1280, with 1 whole station column in view
  //       instead of 4 and 3. The blank is the tail's own price either way --
  //       untailed, the far end ends flush with the last column.
  //       0 when the matrix fits, where inventing overflow would be the
  //       regression, and 0 as well on a card too narrow to hold the frozen
  //       column plus the last one, where no boundary can reach max scroll and
  //       no tail would help.
  // Column geometry is read off the head row -- the snap alignment lives on the
  // data cells, but they share their columns' offsets, and the head is one row
  // to walk instead of 65.
  // Values are written only when they change: the tail alters the box's content
  // size, which is what the observer watches, and a blind write would loop.
  // A layout effect, not a passive one: published after the first paint, the
  // frozen width is missing for that frame and mandatory snapping parks column 2
  // UNDER the frozen column -- measured scrollLeft 103 on the panel's first
  // frame, corrected 27ms later. Self-healing, but visible.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const table = box.querySelector('table');
    const head = box.querySelectorAll('thead th');
    if (!table || head.length < 2) return;
    const first = head[0];
    const set = (name: string, value: string) => {
      if (box.style.getPropertyValue(name) !== value) box.style.setProperty(name, value);
    };
    const sync = () => {
      const tableRect = table.getBoundingClientRect();
      const frozen = first.getBoundingClientRect().width;
      // Max scroll the matrix would have with no tail. clientWidth includes the
      // padding, so this figure does not move as the tail does.
      const plainMax = tableRect.width - box.clientWidth;
      let tail = 0;
      for (let i = 1; plainMax > 0.5 && i < head.length; i++) {
        // Snap position of column i: its start edge, less the frozen column the
        // snapport's start edge is pushed past.
        const snap = head[i].getBoundingClientRect().left - tableRect.left - frozen;
        if (snap >= plainMax - 0.5) {
          tail = snap - plainMax;
          break;
        }
      }
      set('--sw-mscan-frozen', `${frozen}px`);
      set('--sw-mscan-tail', `${Math.max(0, tail)}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    observer.observe(first);
    return () => observer.disconnect();
  }, [scan]);

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

  // The figures in this matrix stay UNGROUPED (`8134`, not `8 134`) while the
  // market table above them was grouped by TASK-169. That is a decision, not an
  // oversight: this table carries one column per tradeable station in the sector
  // and is already 2.9-3.3k px against a ~466px card (see the sw-table-scroll
  // comment below), so a no-break space every three digits is paid ~20 times
  // over here and once there.
  // Known residue of that split: the level-4 forecast in the same cell IS
  // grouped, because TASK-140 pinned it to its own tooltip, so a cell can read
  // «🔴 8134 ×22 →8 134». The cell's own tooltip is what makes that residue
  // payable — it carries the same current price and stock in the grouped form,
  // so a player comparing the matrix against the grouped market table one
  // section above has somewhere to read «8 134» here too. It used to say only
  // «Цена: высокая», which answered a question nobody was asking.
  const renderCell = (g: ScanGood | undefined) => {
    if (!g) return <span className="sw-muted">—</span>;
    const tier = TIER[g.priceLevel];
    const current = g.sellPrice > 0 ? g.sellPrice : g.buyPrice;
    const trend = forecastTrend(current, g.forecastPrice);
    // Only what this scan level actually shows: at level 1 the tier badge is the
    // whole cell, and a tooltip quoting a price the player has not unlocked
    // would hand out the level-2 detail for free.
    const title = [
      `Цена: ${tier.label}`,
      level >= 2 && current > 0 ? `${current.toLocaleString('ru-RU')} cr` : '',
      level >= 3 ? `запас: ${g.stock.toLocaleString('ru-RU')}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="sw-mscan__cell" title={title}>
        <span className="sw-mscan__tier">
          {tier.dot}
          {level >= 2 && (
            <span className="sw-mono sw-mscan__price">{current > 0 ? current : '—'}</span>
          )}
        </span>
        {level >= 3 && <span className="sw-mono sw-muted sw-mscan__stock">×{g.stock}</span>}
        {level >= 4 && g.forecastPrice > 0 && (
          <span
            className={`sw-mono sw-mscan__forecast ${trend.cls}`}
            title={`Прогноз цены: ${g.forecastPrice.toLocaleString('ru-RU')} cr · прогноз запаса: ${g.forecastStock.toLocaleString('ru-RU')}`}
          >
            {trend.arrow}
            {g.forecastPrice.toLocaleString('ru-RU')}
          </span>
        )}
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
          {level === 3 && 'уровень цены + цены + количество'}
          {level >= 4 && 'цены + количество + прогноз цен'}
        </span>
      </div>
      <div className="sw-mscan__legend">
        {TIER.high.dot} высокая&nbsp;&nbsp;{TIER.medium.dot} средняя&nbsp;&nbsp;{TIER.low.dot} низкая
      </div>
      {/* sw-table-scroll: this matrix has one column per tradeable station in the
          sector (22 in sector 1 => 3279px of min-content in full mode, ~2835px
          painted once compaction shrinks its font and padding), so it can never
          fit the HUD centre cell. Without its own scroll container the overflow
          fell to .sw-station__body and scrolling to a far station dragged the
          docked station's own market off screen (TASK-134 AC #3). */}
      <div className="sw-table-scroll" ref={scrollRef}>
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
      </div>
    </section>
  );
}
