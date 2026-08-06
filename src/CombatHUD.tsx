import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  EntityKind,
  commandErrorText,
  installErrorText,
  isStaticTargetKind,
  sendCeaseFire,
  sendInstallJammer,
  sendInstallSatellite,
  sendLaunchMissile,
  sendLaunchTorpedo,
  staticKey,
  staticListOf,
  type CargoInventory,
  type DestructibleStatic,
  type EntityRef,
  type Race,
  type SectorStatics,
  type StationType,
} from './api';
import { shipDisplayName, staticTypeLabel } from './gameContext';
import { launchDronesReported } from './launchDrones';
import { MISSILE_CLASSES } from './missileClasses';
import { recallDronesReported } from './recallDrones';
import type { TrackedShip } from './useWorldState';

// Cargo good that backs the drone button. Mirrors the backend constant
// api.DroneGoodsType, which TASK-167 moved onto the real catalog: 21 «Боевой дрон»
// (space 290). Before that the drone and the missile were 50/51, goods no station
// sold and GET /api/goods had never heard of — so the hold listed them as
// «Товар #50» and a spent magazine could not be refilled. A drone is a big-ship
// weapon at 290: a starter hull (cargobay 50) cannot carry one, and the button says
// so.
const DRONE_GOODS = 21;

// Each of the five missile classes gets its own button with its own hold count,
// mirroring the two torpedo buttons below — goods 11-14 were on sale at 67-72
// stations each and consumed by nothing until TASK-175, the same defect TASK-167
// closed for 10. The class→goods table itself lives in ./missileClasses
// (MISSILE_CLASSES, from ct_missiles) and is shared with ObjectActionsMenu, which
// offers the same five items on the canvas; its backend counterpart is
// domain.MissileGoodsTypes — the api package keeps a constant for class 1 only
// (api.MissileGoodsType), so there is nothing per-class to mirror from there.

// Satellite goods id consumed by one install (phase 10.15). Mirrors
// api.SatelliteGoodsType.
const SATELLITE_GOODS = 26;
// Hyper-interference generator goods id consumed by one install (TASK-131).
// Mirrors api.JammerGoodsType.
const JAMMER_GOODS = 27;
// Torpedo ammunition goods (migration 0042) backing the two torpedo classes.
// Mirror api.TorpedoFirestormGoodsType (gt23, class 2) and
// api.TorpedoHolyGoodsType (gt24, class 3). Phase 10.3.5.
const TORPEDO_FIRESTORM_GOODS = 23;
const TORPEDO_HOLY_GOODS = 24;
const TORPEDO_CLASS_FIRESTORM = 2;
const TORPEDO_CLASS_HOLY = 3;

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
  const targetStatic = targetRef && !targetIsShip ? staticCombat.get(staticKey(targetRef)) : undefined;
  // Denominator of the static's hull bar (TASK-186). A static carries no
  // maximum-hull column anywhere — not on domain.DestructibleStatic, not in the
  // DB — but the hp in the layout frame IS the de-facto maximum: hull damage to
  // a static is never persisted and hull never regenerates (the shield is the
  // only pool that moves up), so the spawn figure is the highest the object has
  // ever had. Two limits come with that. A server restart puts the live value
  // back at this maximum, because static combat state is RAM-only (same
  // limitation as sector/static_combat.go). And if repair (TASK-67) or damage
  // persistence ever lands, this stops being a maximum and the wire owes the
  // client a real maxHP. Absent for a gate — gates are world topology, not
  // sector layout, so staticListOf has no list for them — and the hull then
  // prints as a bare figure.
  const targetStaticMaxHP =
    targetRef && !targetIsShip
      ? staticListOf(statics, targetRef.kind)?.find((s) => s.id === targetRef.id)?.hp
      : undefined;

  const drones = cargoCount(ownCargo, DRONE_GOODS);
  const satellites = cargoCount(ownCargo, SATELLITE_GOODS);
  const jammers = cargoCount(ownCargo, JAMMER_GOODS);
  // Torpedo ammunition per class (phase 10.3.5) + the launcher gate. Without
  // up_torpedo_launcher the server rejects the launch with 422, so both class
  // buttons stay disabled; with the module each is gated on its own hold count.
  const torpedoFirestorm = cargoCount(ownCargo, TORPEDO_FIRESTORM_GOODS);
  const torpedoHoly = cargoCount(ownCargo, TORPEDO_HOLY_GOODS);
  const hasTorpedoLauncher = !!ownShip.equipment?.some((e) => e.type === 'up_torpedo_launcher');

  // toText lets a command translate its own failures (TASK-149: the install-*
  // commands need installErrorText, whose 504 line must not invite a blind
  // retry). The four launch buttons pass commandErrorText for the same reason at
  // one remove: a magazine is charged as one all-or-nothing debit, so on a 502 the
  // shot may well have been fired and paid for, and «Сервер вернул ошибку 502.» —
  // which is what they printed before — reads as a refusal and invites a second
  // one. Re-reading the hold below is not a substitute: it shows the count, not
  // whether this click is the reason it dropped. Cease-fire and recall pass
  // nothing: they move no goods, and the raw backend message is the most specific
  // thing there is to say.
  const run = (action: Promise<unknown>, refresh: boolean, toText?: (err: unknown) => string) => {
    setPending(true);
    setError(null);
    action
      .then(() => {
        setPending(false);
        if (refresh) onCargoChanged();
      })
      .catch((err: unknown) => {
        setPending(false);
        // Re-read the hold after any failure, same as after a success. Nothing
        // else does — WS deltas don't carry cargo and GameLayout re-fetches only
        // on refreshTick — so the counters on these buttons would otherwise keep
        // the pre-command stock exactly when it is most likely wrong: after a
        // lost ack (the command may have applied and spent the goods), and after
        // a 400 «no X in cargo», where the server has just said outright that the
        // hold disagrees with the chip. Unconditional rather than gated on the
        // failure kind because it is one setState and two GETs, and `pending`
        // already caps how often it can fire (TASK-149).
        if (refresh) onCargoChanged();
        if (toText) {
          setError(toText(err));
          return;
        }
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
              // Live hull and shield of a destructible static, both out of the
              // same live combat state: the welcome frame seeds it with every
              // live static in the sector and the per-tick delta keeps it current
              // (TASK-186). The hull gets a bar against the layout's spawn hp
              // (see targetStaticMaxHP) and falls back to a bare figure when
              // there is no layout entry to divide by. A static missing from
              // staticCombat still falls through to the branch below, so the
              // panel cannot crash on one (TASK-113 AC-5).
              <>
                {targetStaticMaxHP && targetStaticMaxHP > 0 ? (
                  <MiniBar label="Корпус" value={targetStatic.hp} max={targetStaticMaxHP} variant="danger" />
                ) : (
                  <div className="sw-vital__head">
                    <span className="sw-vital__label">Корпус</span>
                    <span className="sw-vital__value sw-mono">{targetStatic.hp}</span>
                  </div>
                )}
                {targetStatic.maxShield > 0 && (
                  <MiniBar label="Щиты" value={targetStatic.shield} max={targetStatic.maxShield} variant="" />
                )}
              </>
            ) : (
              // Three different reasons land here, and one line for all three
              // used to claim the wrong one (TASK-166): a static missing from
              // staticCombat read as «вне зоны сканера». Measured on this branch
              // before the split — a laser tower at 85 u and a jammer at 144 u,
              // both far inside ship 1283's radarRange of 420, both told the
              // player the target was off the scanner.
              //
              // Distance was never the cause and a distance test would not have
              // helped: staticCombat used to hold only the statics the worker had
              // marked dirty (collectDirtyDestructibles — damaged or recharging)
              // and was reset to empty on every welcome frame, so an untouched
              // station parked 10 u away had no entry either. Since TASK-186 the
              // welcome frame carries the sector's full live combat state, so
              // every static of this sector reaches the branch above; what still
              // lands here is one that left the big-radar window, which drops it
              // from the layout and the combat map together. The scanner claim is
              // therefore made only for a ship target absent from the AOI ship
              // map (or in another sector) — the reading the player should get,
              // since a target the scanner does not carry is one they cannot see.
              //
              // Do NOT read it backwards as a statement about distance: absence
              // from the ship map is not only distance. snapshot.go's
              // hideStealthed (:429-450) deletes a cloaked hostile from a
              // subscriber's visible set while it holds fire, keeps energy and
              // sits beyond cfg.StealthDetectRange (default 400,
              // sector/config.go:233). So the band where a cloaked ship is inside
              // the player's own radar ring and still absent from this map is
              // 400 < d ≤ radarRange, and how wide that is depends on the hull:
              // measured on the live world, ships carry radarRange 380 (1045 of
              // them), 420 (22), 450 (166) and 500 (60) — empty at 380, up to
              // 100 u at the top classes. It stops being narrow under a
              // navigation satellite: snapshot.go:237 raises the subscriber's
              // radius to SatelliteRevealRadius (10000) and only then calls
              // hideStealthed, so the band becomes 400 < d ≤ 10000. Which is why
              // this line says what the scanner shows and never a figure for how
              // far away the target is.
              <span className="sw-mono" style={{ fontSize: 10, color: 'var(--ink-mute)' }}>
                {!targetRef
                  ? 'Цель не выбрана.'
                  : targetIsShip
                    ? 'Цель вне зоны сканера.'
                    : 'Состояние цели недоступно.'}
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
            {/* One button per missile class, each on its own hold count — the same
                form the two torpedo buttons below use. A single «Запустить ракету»
                could only ever fire class 1, which is why the other four
                ammunition types were purchasable and useless (TASK-175). */}
            {MISSILE_CLASSES.map(({ cls, goods, name, space }) => {
              const count = cargoCount(ownCargo, goods);
              return (
                <WeaponButton
                  key={cls}
                  glyph="◈"
                  label={`Ракета: ${name}`}
                  count={count}
                  disabled={pending || !targetRef || count === 0}
                  title={
                    !targetRef
                      ? 'Нет цели'
                      : count === 0
                        ? `Нет ракет «${name}» в трюме`
                        : `Класс ${cls}, объём ${space} — расходует боеприпас «${name}»`
                  }
                  onClick={() =>
                    targetRef && run(sendLaunchMissile(ownShip.id, targetRef, cls), true, commandErrorText)
                  }
                />
              );
            })}
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
              onClick={() =>
                // No count: the server launches everything up_drone_control runs,
                // or as much of it as the hold holds (TASK-176). The drones===0 gate
                // above is a hint, not the guarantee — the backend owns that now, and
                // launchDronesReported journals how many actually flew.
                targetRef && run(launchDronesReported(ownShip.id, targetRef), true, commandErrorText)
              }
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
              onClick={() =>
                targetRef &&
                run(sendLaunchTorpedo(ownShip.id, targetRef, TORPEDO_CLASS_FIRESTORM), true, commandErrorText)
              }
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
              onClick={() =>
                targetRef && run(sendLaunchTorpedo(ownShip.id, targetRef, TORPEDO_CLASS_HOLY), true, commandErrorText)
              }
            />
            <button
              type="button"
              className="sw-btn ghost"
              disabled={pending}
              onClick={() => run(recallDronesReported(ownShip.id), true)}
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
              onClick={() =>
                run(sendInstallSatellite(ownShip.id), true, (err) => installErrorText(err, 'satellite'))
              }
            />
            <WeaponButton
              glyph="≋"
              label="Установить генератор помех"
              count={jammers}
              disabled={pending || jammers === 0}
              title={
                jammers === 0
                  ? 'Нет генераторов гипер-помех в трюме'
                  : 'Развернуть генератор гипер-помех здесь: блокирует прыжковый двигатель всех кораблей рядом, включая ваш'
              }
              onClick={() =>
                run(sendInstallJammer(ownShip.id), true, (err) => installErrorText(err, 'jammer'))
              }
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
  const hit = staticListOf(statics, ref.kind)?.find((s) => s.id === ref.id);
  const base = staticTypeLabel(ref.kind, hit?.type, stationTypes);
  const raceName = hit?.race ? races.find((r) => r.id === hit.race)?.name : undefined;
  return raceName ? `${base} · ${raceName}` : base;
}

function cargoCount(cargo: CargoInventory | null, typeID: number): number {
  if (!cargo) return 0;
  return cargo.items.find((i) => i.typeID === typeID)?.quantity ?? 0;
}
