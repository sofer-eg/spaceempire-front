import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  EntityKind,
  sendMove,
  type Asteroid,
  type Container,
  type EntityRef,
  type InstalledEquipment,
  type Race,
  type SectorStatics,
  type StationType,
} from './api';
import type { SelectedTargetRef } from './SectorCanvas';
import type { TrackedShip } from './useWorldState';
import { useGalaxy } from './useGalaxy';
import { raceName, shipDisplayName, staticTypeLabel, stationLetter, stationTypeName } from './gameContext';
import { ObjectActionsMenu, type PickedObject } from './ObjectActionsMenu';
import { ObjectMarker } from './objectIcons';
import { emitLog } from './eventBus';

// HighlightRef points to a single row in the Targets panel so the sector
// canvas can outline the same entity while the player hovers. Carrying
// label/x/y here avoids re-deriving them inside the canvas (gate coords
// only live in galaxy; ship/dock coords are interpolated by the canvas
// itself from its own ships/statics). sectorID is the sector the row
// belongs to; the canvas uses it as a guard so a leftover hover state
// from before a sector handoff doesn't paint phantom outlines.
export type HighlightRef = {
  kind: 'ship' | 'gate' | 'dock';
  id: number;
  sectorID: number;
  x: number;
  y: number;
  label: string;
};

type Props = {
  ships: Map<number, TrackedShip>;
  // statics is the same SectorStatics map the canvas paints; we surface the
  // dockable objects as Target rows so the player has an explicit "dock here"
  // affordance instead of having to click a pixel-perfect canvas hit.
  statics: SectorStatics;
  // containers is the live loot-container set within AOI (world.containers).
  // Listed under the "Другие" tab so loot is reachable from the panel, not
  // only by clicking the crate on the canvas (phase 10.9).
  containers?: Map<number, Container>;
  // asteroids is the live minable ore-body set within AOI (world.asteroids),
  // the same set the map draws. Listed under the "Другое" tab so the player
  // can fly to / mine a rock from the panel, not only by clicking it on the
  // canvas (TASK-118 FR-4).
  asteroids?: Map<number, Asteroid>;
  // races is the GET /api/races reference; static row labels get a " · Раса"
  // suffix so the owning faction is visible in the UI (phase 8.13).
  races: Race[];
  // stationTypes is the GET /api/station-types catalog; station / trade-station
  // rows are titled by their type name instead of "Станция #ID" (phase 10.5).
  stationTypes: StationType[];
  currentSectorID: number;
  ownShipID: number;
  ownPlayerID: number;
  // ownShip is the player's own TrackedShip when it exists in the current
  // sector. The panel uses it to compute distance to each row so the
  // dock/jump menu items light up only when the worker would accept the
  // matching command. Null when the player has no ship yet (e.g. between
  // login and spawner ack).
  ownShip: TrackedShip | null;
  // dockRange / gateRange come from the WS welcome and match the worker
  // validation radii. Used to gate the dock/jump menu items.
  dockRange: number;
  gateRange: number;
  logins: Map<number, string>;
  onHoverTarget?: (h: HighlightRef | null) => void;
  // onFocusOwnShip centers the camera on the controlled ship (zoomMode='near'
  // in SectorView). Called when the player clicks the pinned "свой" row in the
  // Ships tab instead of issuing a move command (TASK-118 FR-2).
  onFocusOwnShip?: () => void;
  // selectedTarget identifies the row the player is currently flying to
  // (derived from ownShip.currentTargetRef in SectorView). The matching
  // row renders with the .sw-target-row--selected modifier so the panel
  // stays in sync with the canvas's persistent orange outline.
  selectedTarget?: SelectedTargetRef | null;
};

// The navigation panel groups contacts into three tabs, mirroring the
// original StarWind: ships, stations (stations/shipyards/trade-stations/
// pirbases), and "other" (gates + asteroids + loot containers). Phase 10.9;
// asteroids added in TASK-118. Rows within each tab are sorted deterministically
// (group priority, then id) — see the `order`/`id` fields on Target.
type TabId = 'ships' | 'stations' | 'other';

const TABS: { id: TabId; title: string; noun: string; empty: string }[] = [
  { id: 'ships', title: 'Корабли', noun: 'кораблей', empty: 'Кораблей рядом нет.' },
  { id: 'stations', title: 'Станции', noun: 'станций', empty: 'Станций в секторе нет.' },
  { id: 'other', title: 'Другие объекты (ворота, астероиды, контейнеры)', noun: 'объектов', empty: 'Других объектов нет.' },
];

// NavTabIcon is the glyph shown on a tab button. Shapes echo the canvas /
// contact-row markers (triangle = ship, bracket = station, grid = other) so
// the panel speaks one visual language. Colour is inherited (currentColor)
// so the active/hover button state tints it via CSS.
function NavTabIcon({ kind }: { kind: TabId }) {
  if (kind === 'ships') {
    return (
      <svg width={15} height={15} viewBox="0 0 14 14" aria-hidden>
        <path d="M3 2 L11 7 L3 12 Z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'stations') {
    return (
      <svg width={15} height={15} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
        <path d="M2 5 L2 2 L5 2" />
        <path d="M9 2 L12 2 L12 5" />
        <path d="M2 9 L2 12 L5 12" />
        <path d="M9 12 L12 12 L12 9" />
        <rect x="5.5" y="5.5" width="3" height="3" stroke="none" fill="currentColor" />
      </svg>
    );
  }
  // 'other' — a 2×2 grid, echoing the original "other objects" tab glyph.
  return (
    <svg width={15} height={15} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
      <rect x="2" y="2" width="4" height="4" />
      <rect x="8" y="2" width="4" height="4" />
      <rect x="2" y="8" width="4" height="4" />
      <rect x="8" y="8" width="4" height="4" />
    </svg>
  );
}

type Target = {
  key: string;
  cat: TabId;
  picked: PickedObject;
  // id is the numeric entity id used as the stable secondary sort key inside a
  // group (TASK-118 FR-5). order is the group priority within the tab (lower =
  // higher up): ships → self 0 / others 1; stations → TradeStation 0 / Shipyard
  // 1 / rest 2; other → gate 0 / asteroid 1 / container 2.
  id: number;
  order: number;
  // own marks the controlled ship's self row in the Ships tab: pinned first,
  // click focuses the camera (no move), kebab menu hidden (TASK-118 FR-2).
  own?: boolean;
};

export function TargetsPanel({
  ships,
  statics,
  containers,
  asteroids,
  races,
  stationTypes,
  currentSectorID,
  ownShipID,
  ownPlayerID,
  ownShip,
  dockRange,
  gateRange,
  logins,
  onHoverTarget,
  onFocusOwnShip,
  selectedTarget,
}: Props) {
  const galaxy = useGalaxy();
  // openMenuKey identifies which row's kebab popover is currently open.
  // Only one popover can be open at a time so the cascading list stays
  // readable.
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  // Active navigation tab (phase 10.9). Defaults to ships — the most
  // dynamic / combat-relevant contacts.
  const [tab, setTab] = useState<TabId>('ships');

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    // raceSuffix appends " · Раса" to a static's label when it belongs to a
    // known non-neutral faction (phase 8.13).
    const raceSuffix = (race: number) => {
      const n = raceName(races, race);
      return n ? ` · ${n}` : '';
    };
    for (const s of ships.values()) {
      if (s.sectorID !== currentSectorID) continue;
      // TASK-118 FR-2: the controlled ship is now INCLUDED and pinned first
      // (order 0, own flag) instead of being skipped. Phase 10.7: label ships
      // by name (10.6 shipDisplayName) · owner. The owner suffix is shown only
      // for player-owned ships — own ships read "свой", other players read
      // their login. NPC ships (no human login / the system __npc__) drop the
      // suffix since their name already carries the race/model.
      const isSelf = s.id === ownShipID;
      const name = shipDisplayName(s, races);
      const ownerLogin = s.playerID === ownPlayerID ? 'свой' : logins.get(s.playerID);
      const owner = ownerLogin && ownerLogin !== '__npc__' ? ownerLogin : '';
      out.push({
        key: `ship-${s.id}`,
        cat: 'ships',
        id: s.id,
        order: isSelf ? 0 : 1,
        own: isSelf,
        picked: {
          kind: 'ship',
          id: s.id,
          x: s.x,
          y: s.y,
          label: owner ? `${name} · ${owner}` : name,
        },
      });
    }
    if (galaxy.status === 'ready') {
      const sectorName = new Map(galaxy.world.sectors.map((s) => [s.id, s.name]));
      for (const g of galaxy.world.gates) {
        const inA = g.sectorA === currentSectorID;
        const inB = g.sectorB === currentSectorID;
        if (!inA && !inB) continue;
        const other = inA ? g.sectorB : g.sectorA;
        const x = inA ? g.posAX : g.posBX;
        const y = inA ? g.posAY : g.posBY;
        out.push({
          key: `gate-${g.id}`,
          cat: 'other',
          id: g.id,
          order: 0,
          picked: {
            kind: 'gate',
            id: g.id,
            x,
            y,
            label: `Врата → ${sectorName.get(other) ?? `#${other}`}`,
          },
        });
      }
    }
    // Asteroids (TASK-118 FR-4): the same AOI set the map draws (world.asteroids),
    // surfaced under the "Другое" tab between gates and containers. Labelled by
    // id (ore type / mass stay on the map glyph, gated by the ore scanner) so a
    // rock is reachable for a fly-to / «Бурить» from the panel.
    for (const a of asteroids?.values() ?? []) {
      out.push({
        key: `asteroid-${a.id}`,
        cat: 'other',
        id: a.id,
        order: 1,
        picked: {
          kind: 'asteroid',
          id: a.id,
          x: a.x,
          y: a.y,
          label: `Астероид #${a.id}`,
        },
      });
    }
    for (const st of statics.stations ?? []) {
      out.push({
        key: `station-${st.id}`,
        cat: 'stations',
        id: st.id,
        order: 2,
        picked: {
          kind: 'dock',
          ref: { kind: EntityKind.Station, id: st.id },
          x: st.x,
          y: st.y,
          label: `${staticTypeLabel(EntityKind.Station, st.type, stationTypes)}${raceSuffix(st.race)}`,
          letter: stationLetter(stationTypeName(stationTypes, st.type)),
        },
      });
    }
    for (const sy of statics.shipyards ?? []) {
      out.push({
        key: `shipyard-${sy.id}`,
        cat: 'stations',
        id: sy.id,
        order: 1,
        picked: {
          kind: 'dock',
          ref: { kind: EntityKind.Shipyard, id: sy.id },
          x: sy.x,
          y: sy.y,
          label: `${staticTypeLabel(EntityKind.Shipyard, undefined, stationTypes)}${raceSuffix(sy.race)}`,
        },
      });
    }
    for (const ts of statics.tradeStations ?? []) {
      out.push({
        key: `trade-station-${ts.id}`,
        cat: 'stations',
        id: ts.id,
        order: 0,
        picked: {
          kind: 'dock',
          ref: { kind: EntityKind.TradeStation, id: ts.id },
          x: ts.x,
          y: ts.y,
          label: `${staticTypeLabel(EntityKind.TradeStation, ts.type, stationTypes)}${raceSuffix(ts.race)}`,
        },
      });
    }
    for (const pb of statics.pirbases ?? []) {
      out.push({
        key: `pirbase-${pb.id}`,
        cat: 'stations',
        id: pb.id,
        order: 2,
        picked: {
          kind: 'dock',
          ref: { kind: EntityKind.Pirbase, id: pb.id },
          x: pb.x,
          y: pb.y,
          label: `${staticTypeLabel(EntityKind.Pirbase, undefined, stationTypes)}${raceSuffix(pb.race)}`,
        },
      });
    }
    for (const c of containers?.values() ?? []) {
      out.push({
        key: `container-${c.id}`,
        cat: 'other',
        id: c.id,
        order: 2,
        picked: {
          kind: 'container',
          id: c.id,
          x: c.x,
          y: c.y,
          label: `Контейнер #${c.id}`,
        },
      });
    }
    return out;
  }, [ships, statics, containers, asteroids, races, stationTypes, currentSectorID, ownShipID, ownPlayerID, logins, galaxy]);

  // visible is the subset of contacts for the active tab (phase 10.9),
  // deterministically ordered (TASK-118 FR-5): first by group priority
  // (`order`), then by id ascending, then by key as a final tiebreak so rows
  // never reshuffle between ticks (distance stays in the label only, it is not
  // a sort key). key is unique per entity, so the sort is fully stable even if
  // two different-typed statics share an id.
  const visible = useMemo(
    () =>
      targets
        .filter((t) => t.cat === tab)
        .sort((a, b) => a.order - b.order || a.id - b.id || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    [targets, tab],
  );

  // distTo is the planar distance from the player's current position to
  // a target's world coords. Returns Infinity when ownShip is missing so
  // the labelPrefix anchor stays hidden.
  const distTo = (p: PickedObject): number => {
    if (!ownShip) return Number.POSITIVE_INFINITY;
    const dx = ownShip.x - p.x;
    const dy = ownShip.y - p.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Close popover when an unrelated click lands outside or the user
  // presses Escape. We only attach the listeners while a menu is open
  // so the panel stays cheap when nothing is happening.
  useEffect(() => {
    if (openMenuKey === null) return;
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && t.closest('.sw-target-menu, .sw-target-menu-btn')) return;
      setOpenMenuKey(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpenMenuKey(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuKey]);

  const ownShipPos = ownShip ? { x: ownShip.x, y: ownShip.y } : null;

  return (
    <div className="sw-panel" style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="sw-panel-head">
        <span className="title">Навигация</span>
        <span className="meta">{visible.length} {TABS.find((t) => t.id === tab)?.noun}</span>
      </div>
      <div className="sw-nav-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="sw-nav-tab"
            data-active={tab === t.id ? 'true' : undefined}
            onClick={() => setTab(t.id)}
            title={t.title}
            aria-label={t.title}
            aria-pressed={tab === t.id}
          >
            <NavTabIcon kind={t.id} />
          </button>
        ))}
      </div>
      <div
        className="sw-panel-body"
        style={{ overflow: 'auto', flex: 1 }}
        onMouseLeave={() => onHoverTarget?.(null)}
      >
        <div className="sw-targets">
          {visible.length === 0 && (
            <span className="empty">{TABS.find((t) => t.id === tab)?.empty}</span>
          )}
          {visible.map((t) => {
            const dist = distTo(t.picked);
            const canDock = t.picked.kind === 'dock' && dist <= dockRange;
            const labelPrefix = canDock ? '⚓ ' : '';
            return (
              <TargetRow
                key={t.key}
                target={t.picked}
                own={t.own ?? false}
                onFocusOwnShip={onFocusOwnShip}
                labelPrefix={labelPrefix}
                dist={dist}
                ships={ships}
                ownPlayerID={ownPlayerID}
                ownRace={ownShip?.race ?? 0}
                disabled={ownShipID === 0}
                menuOpen={openMenuKey === t.key}
                onMenuToggle={() =>
                  setOpenMenuKey((cur) => (cur === t.key ? null : t.key))
                }
                onMenuClose={() => setOpenMenuKey(null)}
                onHoverTarget={onHoverTarget}
                sectorID={currentSectorID}
                ownShipID={ownShipID}
                ownShipPos={ownShipPos}
                ownShipAttackTargetID={
                  ownShip?.attackTarget?.kind === EntityKind.Ship
                    ? ownShip.attackTarget.id
                    : undefined
                }
                ownShipMiningTargetID={ownShip?.miningTarget}
                ownEquipment={ownShip?.equipment}
                dockRange={dockRange}
                gateRange={gateRange}
                selected={isSelectedRow(t.picked, selectedTarget)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// TargetRow renders one row + kebab + popover. Extracted so the popover
// can sit inside its own positioned wrapper without bloating the parent's
// JSX, and so TargetsPanel doesn't pay re-render cost when one row's
// menu toggles.
type TargetRowProps = {
  target: PickedObject;
  // own marks the controlled ship's self row (TASK-118 FR-2): click focuses the
  // camera via onFocusOwnShip (no move command), and the kebab menu is hidden.
  own: boolean;
  onFocusOwnShip?: () => void;
  labelPrefix: string;
  // dist is the planar distance from the own ship (Infinity when no ship).
  // ships + ownPlayerID feed ObjectMarker so it can resolve own-vs-enemy
  // colour for ship rows.
  dist: number;
  ships: Map<number, TrackedShip>;
  ownPlayerID: number;
  ownRace: number;
  disabled: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onHoverTarget?: (h: HighlightRef | null) => void;
  sectorID: number;
  ownShipID: number;
  ownShipPos: { x: number; y: number } | null;
  ownShipAttackTargetID?: number;
  ownShipMiningTargetID?: number;
  // ownEquipment is the controlled ship's fit, gating the launch items in
  // ObjectActionsMenu (phase 10.3.2).
  ownEquipment?: InstalledEquipment[];
  dockRange: number;
  gateRange: number;
  selected: boolean;
};

function TargetRow({
  target,
  own,
  onFocusOwnShip,
  labelPrefix,
  dist,
  ships,
  ownPlayerID,
  ownRace,
  disabled,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onHoverTarget,
  sectorID,
  ownShipID,
  ownShipPos,
  ownShipAttackTargetID,
  ownShipMiningTargetID,
  ownEquipment,
  dockRange,
  gateRange,
  selected,
}: TargetRowProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The kebab popover lives inside .sw-panel-body, which has overflow:auto
  // — an in-flow absolute popover gets clipped at the panel edge. We portal
  // the popover to <body> with position:fixed, anchored to the row's
  // bounding rect captured on open. Close it on any ancestor scroll so the
  // floating menu can't end up over a now-shifted row.
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => onMenuClose();
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [menuOpen, onMenuClose]);

  const handleMenuClick = () => {
    if (!menuOpen) {
      const el = wrapRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        // Anchor the menu's right edge to the row's right edge, dropping
        // 4px below. MENU_WIDTH ~= the .sw-menu min-width plus a margin
        // for safety; clamp away from the viewport edge.
        const MENU_WIDTH = 200;
        setMenuRect({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) });
      }
    } else {
      setMenuRect(null);
    }
    onMenuToggle();
  };

  const onRowClick = () => {
    // The pinned "свой" row is an indicator, not a move target (TASK-118 FR-2):
    // clicking it centers the camera on the controlled ship (zoomMode='near')
    // instead of issuing a move command against the ship's own position.
    if (own) {
      onFocusOwnShip?.();
      return;
    }
    if (disabled || ownShipID === 0) return;
    // Gate rows fall through to a bare sendMove (no ref) — gates are not
    // valid EntityRef kinds on the backend, and "Лететь к воротам" still
    // wants to clear any prior selected-target highlight rather than
    // keep pointing at a now-stale entity.
    const ref = pickedObjectRef(target);
    void sendMove(ownShipID, target.x, target.y, ref).catch((err: unknown) => {
      console.error('sendMove', err);
      const msg = err instanceof Error ? err.message : String(err);
      emitLog({ category: 'system', kind: 'danger', message: msg });
    });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div className={`sw-target-row${own ? ' sw-target-row--self' : ''}${selected ? ' sw-target-row--selected' : ''}`}>
        <button
          type="button"
          className={`sw-target-btn ${target.kind === 'gate' ? 'gate' : ''}${
            target.kind === 'dock' ? ' dock' : ''
          }`}
          onClick={onRowClick}
          onMouseEnter={() => {
            // Containers aren't highlighted on the canvas and HighlightRef
            // has no 'container' kind — skip the hover highlight for them
            // (phase 10.9). Asteroids likewise have no HighlightRef kind
            // (phase 10.3.6 / TASK-118).
            if (target.kind === 'container' || target.kind === 'asteroid') return;
            onHoverTarget?.({
              kind: target.kind,
              id: target.kind === 'dock' ? target.ref.id : target.id,
              sectorID,
              x: target.x,
              y: target.y,
              label: target.label,
            });
          }}
          onMouseLeave={() => onHoverTarget?.(null)}
          disabled={disabled}
          title={own ? 'Показать свой корабль' : `Лететь к (${target.x.toFixed(0)}, ${target.y.toFixed(0)})`}
        >
          <ObjectMarker picked={target} ships={ships} ownPlayerID={ownPlayerID} ownRace={ownRace} />
          <span className="sw-target-name">{`${labelPrefix}${target.label}`}</span>
          <span className="pos sw-mono">{Number.isFinite(dist) ? fmtDist(dist) : ''}</span>
        </button>
        {/* The self row is an indicator only — no action menu (TASK-118 FR-2). */}
        {!own && (
          <button
            type="button"
            className="sw-target-menu-btn"
            onClick={handleMenuClick}
            aria-expanded={menuOpen}
            aria-label="Действия над целью"
            title="Действия"
          >
            ⋯
          </button>
        )}
      </div>
      {menuOpen && menuRect &&
        createPortal(
          <div
            className="sw-target-menu"
            style={{
              position: 'fixed',
              top: menuRect.top,
              left: menuRect.left,
              right: 'auto',
              marginTop: 0,
              zIndex: 1000,
            }}
          >
            <ObjectActionsMenu
              target={target}
              ownShipID={ownShipID}
              ownShip={ownShipPos}
              ownShipAttackTargetID={ownShipAttackTargetID}
              ownShipMiningTargetID={ownShipMiningTargetID}
              ownEquipment={ownEquipment}
              dockRange={dockRange}
              gateRange={gateRange}
              onActionDone={onMenuClose}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

// fmtDist renders a distance in world units: bare integer under 1000,
// "N.Nк" (thousands) above so long-range contacts stay compact.
function fmtDist(d: number): string {
  if (!Number.isFinite(d)) return '';
  if (d < 1000) return `${Math.round(d)}`;
  return `${(d / 1000).toFixed(1)}к`;
}

// pickedObjectRef maps a row's target to the EntityRef sendMove should
// carry. Gate rows return undefined — see onRowClick for why.
function pickedObjectRef(target: PickedObject): EntityRef | undefined {
  if (target.kind === 'ship') return { kind: EntityKind.Ship, id: target.id };
  if (target.kind === 'dock') return target.ref;
  return undefined;
}

// isSelectedRow reports whether the row's target matches the
// SelectedTargetRef derived from ownShip.currentTargetRef. Gate rows
// never match (no Gate EntityKind on the backend).
function isSelectedRow(
  target: PickedObject,
  sel: SelectedTargetRef | null | undefined,
): boolean {
  if (!sel) return false;
  if (sel.kind === 'ship') {
    return target.kind === 'ship' && target.id === sel.id;
  }
  return target.kind === 'dock' && target.ref.kind === sel.refKind && target.ref.id === sel.id;
}
