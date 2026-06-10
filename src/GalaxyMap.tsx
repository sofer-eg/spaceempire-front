import { useEffect, useMemo, useRef, useState } from 'react';
import { sendSetCourse, type Race, type WorldSector } from './api';
import { raceColor, raceName } from './gameContext';
import { useGalaxy } from './useGalaxy';

type Props = {
  // Player's current sector — highlighted on the map. 0 when no ship.
  currentSectorID: number;
  // Player's controlled ship — used as the subject of set-course on click.
  // 0 disables clicks.
  ownShipID: number;
  // races is the palette from GET /api/races; each sector's box is tinted
  // by its controlling faction (WorldSector.race), 0 stays neutral.
  races: Race[];
};

type GridPos = { gx: number; gy: number };

// View is the live viewBox rectangle (in layout user units). Zoom narrows
// w/h; pan shifts x/y. null until the first default view is computed.
type View = { x: number; y: number; w: number; h: number };

type Layout = {
  positions: Map<number, GridPos>;
  viewBox: { x: number; y: number; w: number; h: number };
};

type SubmitStatus =
  | { kind: 'idle' }
  | { kind: 'pending'; sectorID: number }
  | { kind: 'ok'; sectorID: number; hops: number }
  | { kind: 'error'; sectorID: number; message: string };

const CELL_SIZE = 110;
const SECTOR_SIZE = 84;
const GAP = CELL_SIZE - SECTOR_SIZE;

// Default view shows the current sector plus VISIBLE_COLS_HALF columns on
// each side (so 2*half + 1 columns wide). DEFAULT_VIEW_ASPECT sets the
// viewBox height as a fraction of its width — with preserveAspectRatio the
// canvas centres the box, so the exact value only trades a few extra rows
// against side margins.
const VISIBLE_COLS_HALF = 5;
const DEFAULT_VIEW_ASPECT = 0.62;
// Zoom factor per wheel notch / per +/- button click. <1 of these applied
// as 1/STEP zooms in (smaller viewBox).
const ZOOM_WHEEL_STEP = 1.12;
const ZOOM_BTN_STEP = 1.4;
// Tightest zoom-in: viewBox no narrower than two cells.
const MIN_VIEW_W = CELL_SIZE * 2;
// Pixels of pointer travel before a drag counts as a pan (so a click still
// reads as "set course").
const DRAG_THRESHOLD_PX = 4;

// Sector-name label fitting. The square is SECTOR_SIZE wide; NAME_AVAIL_W
// leaves a small inner margin. Names wrap to at most two word-balanced
// lines and the font shrinks (within [MIN, MAX]) so the longest line fits.
// NAME_CHAR_RATIO is the per-glyph advance as a fraction of font size for
// the monospace display font plus the small letter-spacing below.
const NAME_AVAIL_W = SECTOR_SIZE - 16;
const NAME_FONT_MAX = 10;
const NAME_FONT_MIN = 7;
const NAME_CHAR_RATIO = 0.66;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function GalaxyMap({ currentSectorID, ownShipID, races }: Props) {
  const galaxy = useGalaxy();
  const [status, setStatus] = useState<SubmitStatus>({ kind: 'idle' });
  const [view, setView] = useState<View | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [flashSectorID, setFlashSectorID] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  // Pan gesture state: anchor client point + the view at pointer-down.
  const panRef = useRef<{ startX: number; startY: number; view: View } | null>(null);
  // True once the current gesture passed the drag threshold — read by the
  // sector click handler to suppress the "set course" action after a pan.
  const draggedRef = useRef(false);
  // True after any zoom/pan/search so the default-view effect stops
  // auto-following the player's sector. Reset clears it.
  const userInteractedRef = useRef(false);
  // Latest clamp ceiling for the native wheel listener (which closes over a
  // stale render otherwise).
  const maxViewWRef = useRef(Infinity);

  const layout = useMemo<Layout | null>(() => {
    if (galaxy.status !== 'ready') return null;
    return buildLayout(galaxy.world.sectors);
  }, [galaxy]);

  // Initialise / re-centre the default view on the player's sector until the
  // user takes control. Re-runs when the player jumps sectors.
  useEffect(() => {
    if (!layout || userInteractedRef.current) return;
    setView(computeDefaultView(layout, currentSectorID));
  }, [layout, currentSectorID]);

  // Native wheel listener so we can preventDefault (React's onWheel is
  // passive). Re-attaches when the svg mounts (layout becomes ready).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userInteractedRef.current = true;
      setView((v) =>
        v ? zoomAtClient(v, svg, e.clientX, e.clientY, e.deltaY, MIN_VIEW_W, maxViewWRef.current) : v,
      );
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [layout]);

  // Keep the zoom-out ceiling current for the wheel/button handlers: a
  // little wider than the whole galaxy, but never narrower than the default
  // window.
  useEffect(() => {
    if (!layout) return;
    maxViewWRef.current = Math.max(
      layout.viewBox.w * 1.25,
      VISIBLE_COLS_HALF * 2 * CELL_SIZE + CELL_SIZE,
    );
  }, [layout]);

  // Clear the search "flash" highlight after a short pulse.
  useEffect(() => {
    if (flashSectorID === null) return;
    const t = setTimeout(() => setFlashSectorID(null), 2600);
    return () => clearTimeout(t);
  }, [flashSectorID]);

  if (galaxy.status === 'loading') {
    return (
      <div className="sw-panel sw-galaxy">
        <div className="sw-panel-head">
          <span className="title">Карта галактики</span>
        </div>
        <div className="sw-galaxy__body">
          <span className="sw-mono" style={{ color: 'var(--ink-mute)' }}>Загрузка…</span>
        </div>
      </div>
    );
  }
  if (galaxy.status === 'error') {
    return (
      <div className="sw-panel sw-galaxy">
        <div className="sw-panel-head">
          <span className="title">Карта галактики</span>
        </div>
        <div className="sw-galaxy__body">
          <span className="sw-mono" style={{ color: 'var(--danger)' }}>Ошибка: {galaxy.message}</span>
        </div>
      </div>
    );
  }
  if (!layout) return null;

  const { positions } = layout;
  const sectors = galaxy.world.sectors;
  const gates = galaxy.world.gates;
  const v = view ?? layout.viewBox;

  const q = searchQuery.trim().toLowerCase();
  const matches = q
    ? sectors
        .filter((s) => s.name.toLowerCase().includes(q) || String(s.id).includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .slice(0, 8)
    : [];

  const onSectorClick = (target: WorldSector) => {
    if (draggedRef.current) return;
    if (ownShipID === 0 || target.id === currentSectorID) return;
    setStatus({ kind: 'pending', sectorID: target.id });
    const cx = (target.bounds.minX + target.bounds.maxX) / 2;
    const cy = (target.bounds.minY + target.bounds.maxY) / 2;
    void sendSetCourse(ownShipID, target.id, cx, cy)
      .then((res) => setStatus({ kind: 'ok', sectorID: target.id, hops: res.hops }))
      .catch((err: unknown) => setStatus({ kind: 'error', sectorID: target.id, message: String(err) }));
  };

  const centerOnSector = (id: number) => {
    const p = positions.get(id);
    if (!p) return;
    const cx = p.gx * CELL_SIZE + SECTOR_SIZE / 2;
    const cy = p.gy * CELL_SIZE + SECTOR_SIZE / 2;
    const w = VISIBLE_COLS_HALF * 2 * CELL_SIZE + CELL_SIZE;
    const h = w * DEFAULT_VIEW_ASPECT;
    userInteractedRef.current = true;
    setView({ x: cx - w / 2, y: cy - h / 2, w, h });
    setFlashSectorID(id);
    setSearchQuery('');
    setSearchFocused(false);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && matches.length > 0) {
      centerOnSector(matches[0].id);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setSearchFocused(false);
    }
  };

  const zoomBtn = (dir: 1 | -1) => {
    userInteractedRef.current = true;
    const factor = dir > 0 ? 1 / ZOOM_BTN_STEP : ZOOM_BTN_STEP;
    setView((cur) => zoomCentered(cur ?? layout.viewBox, factor, MIN_VIEW_W, maxViewWRef.current));
  };

  const resetView = () => {
    userInteractedRef.current = false;
    setFlashSectorID(null);
    setView(computeDefaultView(layout, currentSectorID));
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    draggedRef.current = false;
    panRef.current = { startX: e.clientX, startY: e.clientY, view: v };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    const justStarted = !draggedRef.current;
    if (justStarted && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    draggedRef.current = true;
    userInteractedRef.current = true;
    const scale = svgRef.current?.getScreenCTM()?.a ?? 1;
    setView({ x: pan.view.x - dx / scale, y: pan.view.y - dy / scale, w: pan.view.w, h: pan.view.h });
    if (justStarted) {
      // Capture only once a real drag starts (after setView, so a capture
      // failure can't swallow the pan). Capturing on pointer-down would
      // redirect the follow-up click to the <svg>, so a plain click would
      // never reach the sector <g> (breaking "set course").
      setDragging(true);
      svgRef.current?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panRef.current && draggedRef.current) {
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
    panRef.current = null;
    setDragging(false);
  };

  return (
    <div className="sw-panel sw-galaxy">
      <div className="sw-panel-head">
        <span className="title">Карта галактики</span>
        <div className="sw-row" style={{ gap: 8 }}>
          <div className="sw-galaxy__search">
            <input
              className="sw-input"
              placeholder="Поиск сектора…"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchFocused(true);
              }}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 120)}
              onKeyDown={onSearchKeyDown}
              style={{ width: 170 }}
            />
            {searchFocused && matches.length > 0 && (
              <div className="sw-galaxy__results">
                {matches.map((m) => (
                  <div
                    key={m.id}
                    className="sw-galaxy__result"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      centerOnSector(m.id);
                    }}
                  >
                    <span>{m.name}</span>
                    <span style={{ color: 'var(--ink-mute)' }}>#{m.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="sw-chip">{sectors.length} секторов</span>
          <span className="sw-chip">{gates.length} ворот</span>
        </div>
      </div>
      <div className="sw-galaxy__body">
        <svg
          ref={svgRef}
          className="sw-galaxy__svg"
          viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <radialGradient id="galaxy-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#7fdcff" stopOpacity={0.55} />
              <stop offset="60%" stopColor="#5bcefa" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#5bcefa" stopOpacity={0} />
            </radialGradient>
          </defs>
          {/* Gates first so sector rects overlay endpoints */}
          {gates.map((g) => {
            const a = positions.get(g.sectorA);
            const b = positions.get(g.sectorB);
            if (!a || !b) return null;
            return (
              <line
                key={g.id}
                x1={a.gx * CELL_SIZE + SECTOR_SIZE / 2}
                y1={a.gy * CELL_SIZE + SECTOR_SIZE / 2}
                x2={b.gx * CELL_SIZE + SECTOR_SIZE / 2}
                y2={b.gy * CELL_SIZE + SECTOR_SIZE / 2}
                stroke="rgba(91,206,250,0.45)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            );
          })}
          {sectors.map((s) => {
            const p = positions.get(s.id);
            if (!p) return null;
            const isCurrent = s.id === currentSectorID;
            const isFlash = s.id === flashSectorID;
            const isClickable = ownShipID !== 0 && !isCurrent;
            const label = layoutSectorName(s.name);
            const lineH = label.fontSize + 1;
            const firstBaseline = SECTOR_SIZE / 2 - ((label.lines.length - 1) * lineH) / 2 - 4;
            const idY = firstBaseline + (label.lines.length - 1) * lineH + 13;
            // Faction tint: the sector's controlling race colours its box. The
            // current sector keeps the cyan "you are here" highlight regardless.
            const raceCol = s.race ? raceColor(races, s.race, '') : '';
            const faction = s.race ? raceName(races, s.race) : '';
            return (
              <g
                key={s.id}
                transform={`translate(${p.gx * CELL_SIZE}, ${p.gy * CELL_SIZE})`}
                onClick={() => onSectorClick(s)}
                style={{ cursor: isClickable ? 'pointer' : 'default' }}
              >
                <title>{faction ? `${s.name} · ${faction}` : s.name}</title>
                {isCurrent && (
                  <rect
                    x={-10}
                    y={-10}
                    width={SECTOR_SIZE + 20}
                    height={SECTOR_SIZE + 20}
                    fill="url(#galaxy-glow)"
                  />
                )}
                <rect
                  width={SECTOR_SIZE}
                  height={SECTOR_SIZE}
                  fill={isCurrent ? 'rgba(127,220,255,0.12)' : raceCol || 'rgba(12,26,46,0.6)'}
                  fillOpacity={isCurrent || !raceCol ? 1 : 0.18}
                  stroke={isCurrent ? '#7fdcff' : raceCol || 'rgba(91,206,250,0.45)'}
                  strokeWidth={isCurrent ? 1.4 : 1}
                />
                {isFlash && (
                  <rect
                    className="sw-galaxy__flash"
                    x={-7}
                    y={-7}
                    width={SECTOR_SIZE + 14}
                    height={SECTOR_SIZE + 14}
                    fill="none"
                    stroke="var(--accent-target)"
                    strokeWidth={2.5}
                  />
                )}
                {/* corner notches */}
                {([
                  [0, 0, 1, 1],
                  [SECTOR_SIZE, 0, -1, 1],
                  [0, SECTOR_SIZE, 1, -1],
                  [SECTOR_SIZE, SECTOR_SIZE, -1, -1],
                ] as const).map(([x, y, dx, dy], idx) => (
                  <path
                    key={idx}
                    d={`M ${x + dx * 8} ${y} L ${x} ${y} L ${x} ${y + dy * 8}`}
                    fill="none"
                    stroke={isCurrent ? '#7fdcff' : '#5bcefa'}
                    strokeWidth={1.2}
                  />
                ))}
                <text
                  x={SECTOR_SIZE / 2}
                  textAnchor="middle"
                  fill={isCurrent ? '#7fdcff' : '#e7f2ff'}
                  fontSize={label.fontSize}
                  fontFamily="var(--font-display)"
                  fontWeight={600}
                  letterSpacing="0.05em"
                  style={{ textTransform: 'uppercase' }}
                >
                  {label.lines.map((ln, i) => (
                    <tspan key={i} x={SECTOR_SIZE / 2} y={firstBaseline + i * lineH}>
                      {ln}
                    </tspan>
                  ))}
                </text>
                <text
                  x={SECTOR_SIZE / 2}
                  y={idY}
                  textAnchor="middle"
                  fill={isCurrent ? '#7fdcff' : '#8aa6c4'}
                  fontSize={9}
                  fontFamily="var(--font-mono)"
                >
                  #{s.id}
                </text>
                {isCurrent && (
                  <text
                    x={SECTOR_SIZE / 2}
                    y={SECTOR_SIZE + 14}
                    textAnchor="middle"
                    fill="#7fdcff"
                    fontSize={8}
                    fontFamily="var(--font-mono)"
                    letterSpacing="0.18em"
                  >
                    YOU ARE HERE
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="sw-galaxy__zoom">
          <button type="button" className="sw-btn" title="Приблизить" onClick={() => zoomBtn(1)}>+</button>
          <button type="button" className="sw-btn" title="Отдалить" onClick={() => zoomBtn(-1)}>−</button>
          <button type="button" className="sw-btn ghost" title="Сбросить вид" onClick={resetView}>⟲</button>
        </div>
      </div>
      <div className="sw-galaxy__footer">
        {status.kind === 'pending' && <span>Курс задаётся для сектора #{status.sectorID}…</span>}
        {status.kind === 'ok' && (
          <span style={{ color: 'var(--good)' }}>
            Курс задан в #{status.sectorID}, {status.hops} прыжков
          </span>
        )}
        {status.kind === 'error' && (
          <span style={{ color: 'var(--danger)' }}>
            Сектор #{status.sectorID}: {status.message}
          </span>
        )}
        {status.kind === 'idle' && ownShipID === 0 && (
          <span>Нет корабля — невозможно задать курс.</span>
        )}
        {status.kind === 'idle' && ownShipID !== 0 && (
          <span>Кликните на сектор, чтобы задать курс. Колесо — зум, перетаскивание — сдвиг.</span>
        )}
      </div>
    </div>
  );
}

// computeDefaultView returns a viewBox centred on the player's sector that
// spans VISIBLE_COLS_HALF columns each side. Falls back to the centre of the
// whole-galaxy box when the player has no known sector.
function computeDefaultView(layout: Layout, currentSectorID: number): View {
  const w = VISIBLE_COLS_HALF * 2 * CELL_SIZE + CELL_SIZE;
  const h = w * DEFAULT_VIEW_ASPECT;
  const p = layout.positions.get(currentSectorID);
  const cx = p ? p.gx * CELL_SIZE + SECTOR_SIZE / 2 : layout.viewBox.x + layout.viewBox.w / 2;
  const cy = p ? p.gy * CELL_SIZE + SECTOR_SIZE / 2 : layout.viewBox.y + layout.viewBox.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// clientToSvg maps a screen point to layout user units via the live screen
// CTM, so it accounts for the current viewBox and preserveAspectRatio
// letter-boxing. Returns null if the matrix is unavailable.
function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

// zoomAtClient scales the viewBox uniformly around the cursor so the world
// point under the pointer stays fixed. Under "meet" the letter-box offset is
// invariant to uniform viewBox scaling, so anchoring x/y by the same factor
// keeps the cursor pinned.
function zoomAtClient(
  v: View,
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  deltaY: number,
  minW: number,
  maxW: number,
): View {
  const cur = clientToSvg(svg, clientX, clientY);
  if (!cur) return v;
  const dir = deltaY < 0 ? 1 / ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
  const newW = clamp(v.w * dir, minW, maxW);
  const f = newW / v.w;
  return { x: cur.x - (cur.x - v.x) * f, y: cur.y - (cur.y - v.y) * f, w: newW, h: v.h * f };
}

// zoomCentered scales the viewBox by `factor` keeping its centre fixed —
// used by the +/- buttons.
function zoomCentered(v: View, factor: number, minW: number, maxW: number): View {
  const newW = clamp(v.w * factor, minW, maxW);
  const f = newW / v.w;
  const newH = v.h * f;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
}

// layoutSectorName wraps a sector name to at most two word-balanced lines and
// picks the largest font (within [MIN, MAX]) at which the longest line fits
// NAME_AVAIL_W. A single over-long word is truncated with an ellipsis at the
// minimum font; the full name is always available via the <title> tooltip.
function layoutSectorName(name: string): { lines: string[]; fontSize: number } {
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  let best = { lines: [trimmed], longest: trimmed.length };
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const longest = Math.max(l1.length, l2.length);
    if (longest < best.longest) best = { lines: [l1, l2], longest };
  }
  let fontSize = Math.floor(NAME_AVAIL_W / (best.longest * NAME_CHAR_RATIO));
  fontSize = clamp(fontSize, NAME_FONT_MIN, NAME_FONT_MAX);
  const maxChars = Math.floor(NAME_AVAIL_W / (NAME_FONT_MIN * NAME_CHAR_RATIO));
  const lines = best.lines.map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
  return { lines, fontSize };
}

// buildLayout places every sector at its galactic grid coordinate
// (WorldSector.gridX/gridY, the StarWind pos_x/pos_y). The grid is collision-
// free by construction (each sector owns a unique cell) and the SVG Y axis
// grows downward, so a south gate puts its neighbour one row below, east one
// column right — matching the original schematic map. Gates are drawn as
// connectors between cells by the caller. The viewBox spans the full grid
// extent with a one-cell margin.
function buildLayout(sectors: WorldSector[]): {
  positions: Map<number, GridPos>;
  viewBox: { x: number; y: number; w: number; h: number };
} {
  const positions = new Map<number, GridPos>();
  if (sectors.length === 0) {
    return { positions, viewBox: { x: 0, y: 0, w: CELL_SIZE, h: CELL_SIZE } };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of sectors) {
    positions.set(s.id, { gx: s.gridX, gy: s.gridY });
    if (s.gridX < minX) minX = s.gridX;
    if (s.gridX > maxX) maxX = s.gridX;
    if (s.gridY < minY) minY = s.gridY;
    if (s.gridY > maxY) maxY = s.gridY;
  }
  return {
    positions,
    viewBox: {
      x: minX * CELL_SIZE - GAP,
      y: minY * CELL_SIZE - GAP,
      w: (maxX - minX + 1) * CELL_SIZE + GAP * 2,
      h: (maxY - minY + 1) * CELL_SIZE + GAP * 2,
    },
  };
}
