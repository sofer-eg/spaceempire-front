import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  EntityKind,
  isStaticTargetKind,
  sendCeaseFire,
  sendInstallSatellite,
  sendLaunchDrone,
  sendLaunchMissile,
  sendLaunchTorpedo,
  sendRecallDrones,
  type CargoInventory,
  type DestructibleStatic,
  type EntityRef,
  type Race,
  type SectorStatics,
  type StationType,
} from './api';
import { shipDisplayName, staticTypeLabel } from './gameContext';
import type { TrackedShip } from './useWorldState';

// Cargo goods that back the launch buttons. Mirror the backend constants:
// api.MissileGoodsType (migration 0017) and api.DroneGoodsType (0018).
const MISSILE_GOODS = 50;
const DRONE_GOODS = 51;
// Satellite goods id consumed by one install (phase 10.15). Mirrors
// api.SatelliteGoodsType.
const SATELLITE_GOODS = 26;
// Torpedo ammunition goods (migration 0042) backing the two torpedo classes.
// Mirror api.TorpedoFirestormGoodsType (gt23, class 2) and
// api.TorpedoHolyGoodsType (gt24, class 3). Phase 10.3.5.
const TORPEDO_FIRESTORM_GOODS = 23;
const TORPEDO_HOLY_GOODS = 24;
const TORPEDO_CLASS_FIRESTORM = 2;
const TORPEDO_CLASS_HOLY = 3;
// DRONE_SALVO matches ObjectActionsMenu — one launch action sends a small
// fixed salvo so the button stays a single click.
const DRONE_SALVO = 3;

type Props = {
  ownShip: TrackedShip;
  ships: Map<number, TrackedShip>;
  logins: Map<number, string>;
  // races backs shipDisplayName for the target label (phase 10.7).
  races: Race[];
  // statics + stationTypes resolve the label of a destructible-static target
  // (TASK-113 FR-03); staticCombat carries its live HP/Shield for the bars.
  statics: SectorStatics;
  staticCombat: Map<string, DestructibleStatic>;
  stationTypes: StationType[];
  ownCargo: CargoInventory | null;
  ownSectorID: number;
  // onCargoChanged re-fetches the wallet/cargo after a launch or recall so
  // the missile/drone counts below stay live (GameLayout.refreshPlayer).
  onCargoChanged: () => void;
};

// CombatHUD is the in-flight weapons + target panel. It surfaces the
// current laser target's hull/shield (when inside the AOI scanner), the
// missile/drone stock in the hold, and the launch/recall/cease-fire
// actions — the same commands the canvas context menu issues, hoisted to
// a persistent HUD so the player isn't hunting for a right-click during a
// fight.
export function CombatHUD({ ownShip, ships, logins, races, statics, staticCombat, stationTypes, ownCargo, ownSectorID, onCargoChanged }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Jump-drive gate (TASK-129): the «⚡ Прыжок» section renders only when the
  // active ship carries up_jump_drive; the button itself is disabled without a
  // working shield generator (maxShield<=0), which the backend also requires.
  const hasJumpDrive = !!ownShip.equipment?.some((e) => e.type === 'up_jump_drive');
  const shieldGenOk = ownShip.maxShield > 0;

  // The combat target is whatever the laser is firing at; falls back to the
  // navigation target when it is targetable (a ship OR a destructible static),
  // so the player can pre-arm missiles/torpedoes at a station/ship they are
  // flying toward before opening fire (TASK-113 FR-03).
  const attackRef = refIfTargetable(ownShip.attackTarget);
  const navRef = refIfTargetable(ownShip.currentTargetRef);
  const targetRef = attackRef ?? navRef;
  const firing = attackRef !== null;

  // A ship target resolves from the live ship map (HP/shield bars); a static
  // target resolves from the static-combat snapshot. ships.get is gated on the
  // kind so a static id never collides with a same-numbered ship.
  const targetIsShip = targetRef?.kind === EntityKind.Ship;
  const targetShip = targetIsShip ? ships.get(targetRef.id) : undefined;
  const inScanner = targetShip != null && targetShip.sectorID === ownSectorID;
  const targetStatic =
    targetRef && !targetIsShip ? staticCombat.get(`${targetRef.kind}:${targetRef.id}`) : undefined;

  const missiles = cargoCount(ownCargo, MISSILE_GOODS);
  const drones = cargoCount(ownCargo, DRONE_GOODS);
  const satellites = cargoCount(ownCargo, SATELLITE_GOODS);
  // Torpedo ammunition per class (phase 10.3.5) + the launcher gate. Without
  // up_torpedo_launcher the server rejects the launch with 422, so both class
  // buttons stay disabled; with the module each is gated on its own hold count.
  const torpedoFirestorm = cargoCount(ownCargo, TORPEDO_FIRESTORM_GOODS);
  const torpedoHoly = cargoCount(ownCargo, TORPEDO_HOLY_GOODS);
  const hasTorpedoLauncher = !!ownShip.equipment?.some((e) => e.type === 'up_torpedo_launcher');

  const run = (action: Promise<unknown>, refresh: boolean) => {
    setPending(true);
    setError(null);
    action
      .then(() => {
        setPending(false);
        if (refresh) onCargoChanged();
      })
      .catch((err: unknown) => {
        setPending(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  // Phase 10.7: same name · owner format as the navigation panel. A static
  // target reads as its type · race (TASK-113 FR-03). When a ship target is
  // outside the AOI scanner (no targetShip) we only have the id.
  let targetLabel: string | null = null;
  if (targetRef) {
    if (targetIsShip) {
      if (targetShip) {
        const name = shipDisplayName(targetShip, races);
        const ownerLogin = logins.get(targetShip.playerID);
        const owner = ownerLogin && ownerLogin !== '__npc__' ? ownerLogin : '';
        targetLabel = owner ? `${name} · ${owner}` : name;
      } else {
        targetLabel = `SHIP-${targetRef.id}`;
      }
    } else {
      targetLabel = staticTargetLabel(targetRef, statics, stationTypes, races);
    }
  }

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <span className="title">Бой</span>
        {firing ? (
          <span className="sw-chip dot danger">ОГОНЬ</span>
        ) : (
          <span className="meta">{targetRef ? 'ЦЕЛЬ' : 'НЕТ ЦЕЛИ'}</span>
        )}
      </div>
      <div className="sw-panel-body">
        <div className="sw-col" style={{ gap: 12 }}>
          <div className="sw-col" style={{ gap: 8 }}>
            <div className="sw-row" style={{ justifyContent: 'space-between' }}>
              <span className="sw-hh">Цель</span>
              <span className="sw-mono" style={{ fontSize: 11, color: 'var(--accent-target)' }}>
                {targetLabel ?? '—'}
              </span>
            </div>
            {targetIsShip && inScanner && targetShip ? (
              <>
                <MiniBar label="Корпус" value={targetShip.hp} max={targetShip.maxHP} variant="danger" />
                <MiniBar label="Щиты" value={targetShip.shield} max={targetShip.maxShield} variant="" />
              </>
            ) : targetStatic ? (
              // A destructible static carries no maxHP on the client (TASK-113
              // NFR-02), so the hull is a numeric readout and only the shield —
              // which has a max — gets a bar. Absent staticCombat falls through
              // to the scanner message below (AC-5: never crashes the panel).
              <>
                <div className="sw-vital__head">
                  <span className="sw-vital__label">Корпус</span>
                  <span className="sw-vital__value sw-mono">{targetStatic.hp}</span>
                </div>
                {targetStatic.maxShield > 0 && (
                  <MiniBar label="Щиты" value={targetStatic.shield} max={targetStatic.maxShield} variant="" />
                )}
              </>
            ) : (
              <span className="sw-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                {targetRef ? 'Цель вне зоны сканера.' : 'Цель не выбрана.'}
              </span>
            )}
          </div>

          <div className="sw-div" />

          <div className="sw-col" style={{ gap: 6 }}>
            <div className="sw-row" style={{ justifyContent: 'space-between' }}>
              <span className="sw-hh">Вооружение</span>
            </div>
            {firing && (
              <button
                type="button"
                className="sw-btn ghost"
                disabled={pending}
                onClick={() => run(sendCeaseFire(ownShip.id), false)}
              >
                ◇ Прекратить огонь
              </button>
            )}
            <WeaponButton
              glyph="◈"
              label="Запустить ракету"
              count={missiles}
              disabled={pending || !targetRef || missiles === 0}
              title={!targetRef ? 'Нет цели' : missiles === 0 ? 'Нет ракет в трюме' : undefined}
              onClick={() => targetRef && run(sendLaunchMissile(ownShip.id, targetRef), true)}
            />
            <WeaponButton
              glyph="⬡"
              label="Запустить дронов"
              count={drones}
              disabled={pending || !targetRef || !targetIsShip || drones === 0}
              title={
                !targetRef
                  ? 'Нет цели'
                  : !targetIsShip
                    ? 'Дроны атакуют только корабли'
                    : drones === 0
                      ? 'Нет дронов в трюме'
                      : undefined
              }
              onClick={() => targetRef && run(sendLaunchDrone(ownShip.id, targetRef, DRONE_SALVO), true)}
            />
            <WeaponButton
              glyph="☄"
              label="Торпеда: Огненная Буря"
              count={torpedoFirestorm}
              disabled={pending || !targetRef || !hasTorpedoLauncher || torpedoFirestorm === 0}
              title={
                !hasTorpedoLauncher
                  ? 'Нужна торпедная установка (up_torpedo_launcher)'
                  : !targetRef
                    ? 'Нет цели'
                    : torpedoFirestorm === 0
                      ? 'Нет торпед «Огненная Буря» (gt23)'
                      : undefined
              }
              onClick={() => targetRef && run(sendLaunchTorpedo(ownShip.id, targetRef, TORPEDO_CLASS_FIRESTORM), true)}
            />
            <WeaponButton
              glyph="☄"
              label="Торпеда: Святая Торпеда"
              count={torpedoHoly}
              disabled={pending || !targetRef || !hasTorpedoLauncher || torpedoHoly === 0}
              title={
                !hasTorpedoLauncher
                  ? 'Нужна торпедная установка (up_torpedo_launcher)'
                  : !targetRef
                    ? 'Нет цели'
                    : torpedoHoly === 0
                      ? 'Нет торпед «Святая Торпеда» (gt24)'
                      : undefined
              }
              onClick={() => targetRef && run(sendLaunchTorpedo(ownShip.id, targetRef, TORPEDO_CLASS_HOLY), true)}
            />
            <button
              type="button"
              className="sw-btn ghost"
              disabled={pending}
              onClick={() => run(sendRecallDrones(ownShip.id), true)}
            >
              ⬡ Вернуть дронов
            </button>
          </div>

          <div className="sw-div" />

          <div className="sw-col" style={{ gap: 6 }}>
            <div className="sw-row" style={{ justifyContent: 'space-between' }}>
              <span className="sw-hh">Развёртывание</span>
            </div>
            <WeaponButton
              glyph="✦"
              label="Установить спутник"
              count={satellites}
              disabled={pending || satellites === 0}
              title={satellites === 0 ? 'Нет спутников в трюме' : 'Развернуть навигационный спутник здесь'}
              onClick={() => run(sendInstallSatellite(ownShip.id), true)}
            />
          </div>

          {hasJumpDrive && (
            <>
              <div className="sw-div" />
              <div className="sw-col" style={{ gap: 6 }}>
                <div className="sw-row" style={{ justifyContent: 'space-between' }}>
                  <span className="sw-hh">Прыжковый двигатель</span>
                </div>
                <button
                  type="button"
                  className="sw-btn ghost"
                  disabled={!shieldGenOk}
                  title={
                    !shieldGenOk
                      ? 'Нужен исправный генератор щита'
                      : 'Выбрать сектор для прыжка на карте галактики'
                  }
                  onClick={() => navigate('/galaxy', { state: { jumpShipID: ownShip.id } })}
                >
                  ⚡ Прыжок
                </button>
              </div>
            </>
          )}

          {error && (
            <span className="sw-mono" style={{ fontSize: 10, color: 'var(--danger)' }}>
              {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// WeaponButton renders a launch action with the hold count as a trailing
// chip so the player sees ammunition at a glance.
function WeaponButton({
  glyph,
  label,
  count,
  disabled,
  title,
  onClick,
}: {
  glyph: string;
  label: string;
  count: number;
  disabled: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sw-btn ghost"
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
    >
      <span>
        {glyph} {label}
      </span>
      <span className="sw-mono" style={{ color: count > 0 ? 'var(--accent-hot)' : 'var(--ink-mute)' }}>
        ×{count}
      </span>
    </button>
  );
}

// MiniBar mirrors PilotPanel's Vital markup (.sw-vital/.sw-bar) for the
// target's hull/shield, kept local so the target block doesn't depend on
// PilotPanel's internals.
function MiniBar({ label, value, max, variant }: { label: string; value: number; max: number; variant: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="sw-vital">
      <div className="sw-vital__head">
        <span className="sw-vital__label">{label}</span>
        <span className="sw-vital__value sw-mono">{`${value} / ${max}`}</span>
      </div>
      <div className={`sw-bar ${variant}`}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// refIfTargetable keeps a ref the HUD weapons can lock onto (TASK-113 FR-03):
// a ship OR a destructible static. Other kinds (gate/container/asteroid) yield
// null so the panel shows "no target".
function refIfTargetable(ref: EntityRef | undefined): EntityRef | null {
  if (!ref) return null;
  return ref.kind === EntityKind.Ship || isStaticTargetKind(ref.kind) ? ref : null;
}

// staticTargetLabel resolves a destructible static's HUD caption — its type
// (station/shipyard/…) and, when known, its race (TASK-113 FR-03). Falls back
// to the bare type name when the static is not in the current statics frame
// (e.g. just left the radar window).
function staticTargetLabel(
  ref: EntityRef,
  statics: SectorStatics,
  stationTypes: StationType[],
  races: Race[],
): string {
  const hit = findStatic(ref, statics);
  const base = staticTypeLabel(ref.kind, hit?.type, stationTypes);
  const raceName = hit?.race ? races.find((r) => r.id === hit.race)?.name : undefined;
  return raceName ? `${base} · ${raceName}` : base;
}

// findStatic locates the static object matching ref so its type/race can label
// the HUD target. Returns undefined when the static is not in the frame.
function findStatic(ref: EntityRef, statics: SectorStatics): { type?: number; race: number } | undefined {
  const byId = <T extends { id: number; race: number; type?: number }>(list: T[] | undefined) =>
    list?.find((s) => s.id === ref.id);
  switch (ref.kind) {
    case EntityKind.Station:
      return byId(statics.stations);
    case EntityKind.Shipyard:
      return byId(statics.shipyards);
    case EntityKind.TradeStation:
      return byId(statics.tradeStations);
    case EntityKind.Pirbase:
      return byId(statics.pirbases);
    case EntityKind.LaserTower:
      return byId(statics.laserTowers);
    case EntityKind.Satellite:
      return byId(statics.satellites);
    default:
      return undefined;
  }
}

function cargoCount(cargo: CargoInventory | null, typeID: number): number {
  if (!cargo) return 0;
  return cargo.items.find((i) => i.typeID === typeID)?.quantity ?? 0;
}
