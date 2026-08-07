import { useState } from 'react';
import {
  EntityKind,
  commandErrorText,
  isDockableStaticKind,
  isMissileTargetKind,
  isStaticTargetKind,
  sendAttack,
  sendCeaseFire,
  sendDismantleStatic,
  sendDock,
  sendHack,
  sendJump,
  sendLaunchMissile,
  sendCapture,
  sendLaunchTorpedo,
  sendMine,
  sendMove,
  sendPickupContainer,
  type EntityRef,
  type InstalledEquipment,
} from './api';
import { emitLog } from './eventBus';
import { launchDronesReported } from './launchDrones';
import { MISSILE_CLASSES } from './missileClasses';
import { recallDronesReported } from './recallDrones';
import { relationColor, type Relation } from './sector/shapeData';

// Torpedo ammunition classes (ЧТЗ doc-1 §3): 2 = «Огненная Буря» (gt23),
// 3 = «Святая Торпеда» (gt24). The on-canvas menu offers one button per class,
// gated on the launcher module; the hold-count gate lives in CombatHUD (which
// has the cargo), mirroring how the missile items here gate on launcher only.
const TORPEDO_CLASS_FIRESTORM = 2;
const TORPEDO_CLASS_HOLY = 3;

// One missile item per ammunition class (MISSILE_CLASSES, ct_missiles), same as the
// torpedoes above — the single «Запустить ракету» item this replaces could only fire
// class 1, so a player working from the canvas could not use the four dearer types at
// all (TASK-175). Hold counts are deliberately absent: this menu has no cargo of its
// own; CombatHUD carries the per-class counters.

// PickedObject is the unified target type shared by TargetsPanel (rows) and
// SectorCanvas (click-on-object). It carries everything the action menu
// needs to render and to issue the right backend command — world coords for
// distance gating and sendMove, EntityRef for sendDock, gate id for
// sendJump.
export type PickedObject =
  // maxShield is the target ship's shield-generator ceiling (WS
  // TrackedShip.maxShield). The capture affordance mirrors the server's
  // "shield generator destroyed" gate on maxShield===0 — a permanently
  // knocked-off up_shield, NOT a merely depleted current shield (phase
  // 10.3.9.5); every ship pick supplies it.
  | { kind: 'ship'; id: number; x: number; y: number; label: string; maxShield: number; relation?: Relation }
  | { kind: 'gate'; id: number; x: number; y: number; label: string }
  // ownerID is the deploying player of a player-placed object (jammer /
  // navigation satellite, both carried as dock picks). Present only for those two
  // kinds; it drives the «Демонтировать» affordance, which only the owner gets
  // (TASK-146). World fixtures (stations, gates, towers) leave it undefined.
  | { kind: 'dock'; ref: EntityRef; x: number; y: number; label: string; letter?: string; ownerID?: number }
  | { kind: 'container'; id: number; x: number; y: number; label: string }
  // A torpedo is a shoot-downable projectile (TASK-112): the only action it takes
  // is «Сбить» — an ordered laser shot, which the server accepts for a torpedo
  // regardless of whose it is (aborting your own is legitimate). own marks the
  // player's own ordnance so the menu can say so.
  | { kind: 'torpedo'; id: number; x: number; y: number; label: string; own?: boolean }
  // asteroid carries the human-readable ore label and remaining mass so the
  // menu head reads "Руда · 240" rather than a raw ore_type id (phase 10.3.6).
  | { kind: 'asteroid'; id: number; x: number; y: number; label: string };

type Props = {
  target: PickedObject;
  // ownShipID is the ship that will execute the command. 0 disables every
  // action — the player has no ship in this sector yet.
  ownShipID: number;
  // ownPlayerID is the logged-in player, compared against a deployed object's
  // ownerID for the «Демонтировать» gate (TASK-146): only your own generator or
  // satellite folds back into your hold — someone else's has to be shot.
  ownPlayerID: number;
  // ownShip carries the player's own position for the dock/jump range check.
  // null when the player has no ship in this sector — every range gate
  // resolves to false and the corresponding menu items render disabled.
  ownShip: { x: number; y: number } | null;
  // ownShipAttackTargetID is the id of the ship the player is currently
  // firing at (or undefined / 0 when not engaged). Used to flip the
  // "Атаковать" item to "Прекратить огонь" when the menu is opened on
  // the current target.
  ownShipAttackTargetID?: number;
  // ownShipMiningTargetID is the id of the asteroid the controlled ship is
  // currently sustained-mining (or undefined when idle). Used to flip «Бурить»
  // to «Прекратить добычу» when the menu is opened on that asteroid (phase
  // 10.3.21), mirroring ownShipAttackTargetID for fire/cease-fire.
  ownShipMiningTargetID?: number;
  // ownEquipment is the controlled ship's installed-module list (phase 10.3.2).
  // Used to gate the launch-missile / launch-drones items: the server rejects
  // those commands with 422 when the ship lacks up_launcher / up_drone_control,
  // so the menu disables the affordance instead of letting the click fail into
  // the journal. Absent (undefined) for a ship with no modules → both gated off.
  ownEquipment?: InstalledEquipment[];
  dockRange: number;
  gateRange: number;
  // className lets the parent position the popover (`.sw-target-menu` for
  // panel rows, `.sw-canvas-menu` for canvas-anchored). The component
  // always also carries the base `.sw-menu` look.
  className?: string;
  // onCargoChanged fires after an action that moved goods into or out of the
  // ship's hold, so the parent can re-read it. Only the dismantle needs it today
  // (TASK-146): the whole point of the action is that the object is back in the
  // hold, and the ГРУЗ bar is otherwise only re-fetched on a ship change or a
  // buy/sell, so it would keep showing the pre-dismantle figure.
  onCargoChanged?: () => void;
  // onActionDone fires after a command resolves successfully so the parent
  // can dismiss the popover. Failures keep the menu open and surface the
  // error inline.
  onActionDone?: () => void;
};

export function ObjectActionsMenu({
  target,
  ownShipID,
  ownPlayerID,
  ownShip,
  ownShipAttackTargetID,
  ownShipMiningTargetID,
  ownEquipment,
  dockRange,
  gateRange,
  className,
  onCargoChanged,
  onActionDone,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dist = ownShip
    ? Math.hypot(ownShip.x - target.x, ownShip.y - target.y)
    : Number.POSITIVE_INFINITY;
  // A satellite, a laser tower (TASK-113) and a hyper-interference generator
  // (TASK-131) are weapon targets but not dockable — isDockableStaticKind keeps
  // that list in one place so we never offer a "Стыковка" the server would
  // reject, and TargetsPanel's ⚓ prefix stays in step with this menu.
  const canDock =
    target.kind === 'dock' &&
    isDockableStaticKind(target.ref.kind) &&
    dist <= dockRange;
  const canJump = target.kind === 'gate' && dist <= gateRange;
  const isOwnShip = target.kind === 'ship' && target.id === ownShipID;
  // Weapon targeting (TASK-113 FR-02): missiles and torpedoes may strike an
  // enemy ship OR a destructible static (isStaticTargetKind). weaponRef is the
  // EntityRef the launch commands take; null when the target takes no weapon
  // (own ship, gate, container, asteroid). Drones stay ship-only (C-03).
  const isStaticWeaponTarget = target.kind === 'dock' && isStaticTargetKind(target.ref.kind);
  const canTargetWeapon = (target.kind === 'ship' && !isOwnShip) || isStaticWeaponTarget;
  const weaponRef: EntityRef | null =
    target.kind === 'ship' && !isOwnShip
      ? { kind: EntityKind.Ship, id: target.id }
      : target.kind === 'dock' && isStaticTargetKind(target.ref.kind)
        ? target.ref
        : null;
  // Missiles reach wider than the laser and the torpedo (TASK-111): besides ships
  // and destructible statics they hit a gate (a dock-category pick since TASK-110
  // made gates destructible, but the canvas/panel still surface a gate as its own
  // 'gate' category) and a loot container, which is destroyed with its cargo.
  // missileRef is the EntityRef the launch takes for those two extra kinds; the
  // laser/torpedo items keep using weaponRef and stay off them.
  const missileRef: EntityRef | null =
    weaponRef ??
    (target.kind === 'gate'
      ? { kind: EntityKind.Gate, id: target.id }
      : target.kind === 'container'
        ? { kind: EntityKind.Container, id: target.id }
        : null);
  const canLaunchMissile = !!missileRef && (missileRef.kind === EntityKind.Ship || isMissileTargetKind(missileRef.kind));

  const isCurrentlyAttacking =
    target.kind === 'ship' &&
    !!ownShipAttackTargetID &&
    ownShipAttackTargetID === target.id;
  // Mining toggle (phase 10.3.21): show «Прекратить добычу» only when the
  // controlled ship is mining this very asteroid; otherwise «Бурить» (which
  // also switches targets when mining a different rock), mirroring the
  // attack/cease-fire flip above.
  const isCurrentlyMining =
    target.kind === 'asteroid' &&
    !!ownShipMiningTargetID &&
    ownShipMiningTargetID === target.id;
  const baseDisabled = pending || ownShipID === 0;
  // Capability gates (phase 10.3.2): missiles need up_launcher, drones need
  // up_drone_control. Mirrors the server's 422 gate so the click never fails.
  const hasLauncher = !!ownEquipment?.some((e) => e.type === 'up_launcher');
  const hasDroneControl = !!ownEquipment?.some((e) => e.type === 'up_drone_control');
  // Torpedoes need up_torpedo_launcher (phase 10.3.5). Mirrors the server's 422
  // ErrEquipmentRequired gate so the click never fails into the journal.
  const hasTorpedoLauncher = !!ownEquipment?.some((e) => e.type === 'up_torpedo_launcher');
  // Mining needs up_drill (phase 10.3.6). Mirrors the server's 422
  // ErrEquipmentRequired gate so the click never fails into the journal.
  const hasDrill = !!ownEquipment?.some((e) => e.type === 'up_drill');
  // Capture needs up_capture (phase 10.3.9.5). Mirrors the server's 422
  // ErrEquipmentRequired gate so the click never fails into the journal.
  const hasCapture = !!ownEquipment?.some((e) => e.type === 'up_capture');
  // The server gates capture on !shipsAreFriendly (damage-parity), NOT strictly
  // hostile — a neutral ship is capturable too. Mirror that: only self/ally are
  // friendly (uncapturable). relation is present on every ship pick; treat a
  // missing one as non-friendly and let the server stay authoritative.
  const captureTargetFriendly =
    target.kind === 'ship' &&
    (target.relation === 'self' || target.relation === 'ally');
  // Shield-generator mirror of the server's ErrCaptureShielded gate: capture
  // opens only once MaxShield≤0 (up_shield permanently knocked off). Current
  // shield dips to 0 under ordinary fire while the generator regenerates, so
  // gating on live shield would falsely enable the button mid-firefight — gate
  // on maxShield. The server re-checks MaxShield>0 authoritatively.
  const captureShieldUp = target.kind === 'ship' && target.maxShield > 0;
  const captureTitle = !hasCapture
    ? 'Нужен захватчик (up_capture)'
    : captureTargetFriendly
      ? 'Нельзя захватить союзный корабль'
      : captureShieldUp
        ? 'Сначала сбейте щит цели'
        : undefined;
  // Hack needs up_hack (phase 10.3.9.6). Mirrors the server's 422
  // ErrEquipmentRequired gate so a click never fails into the journal. The
  // button is only offered for a production or trade station target; the
  // remaining gates (goods ≥30%, distance, race≠6, built) are server-authoritative
  // — the client can't see the station's stock, so it defers to the 4xx→journal.
  const hasHack = !!ownEquipment?.some((e) => e.type === 'up_hack');
  const canHackTarget =
    target.kind === 'dock' &&
    (target.ref.kind === EntityKind.Station || target.ref.kind === EntityKind.TradeStation);

  // Dismantle (TASK-146): only the owner of a deployed generator / satellite can
  // fold it back into the hold. Range and hold-space are server-authoritative
  // (422 → journal), like the hack item — the client cannot see the hold's free
  // space from here.
  const canDismantle =
    target.kind === 'dock' &&
    (target.ref.kind === EntityKind.Jammer || target.ref.kind === EntityKind.Satellite) &&
    !!target.ownerID &&
    target.ownerID === ownPlayerID;

  // toText lets one action word its own failures, the same hook CombatHUD.run has.
  // Only the actions that move something pass one: the three ordnance launches
  // charge the magazine as a single all-or-nothing debit, and pickup / dismantle
  // put goods into the hold, so on a 502 or a dropped connection the command may
  // have applied and «Сервер вернул ошибку 502.» would read as a refusal (TASK-168
  // AC #3). Unlike CombatHUD.run this menu does not re-read the hold after a
  // failure — it has no ownCargo of its own, only onCargoChanged, which dismantle
  // calls on success — so the text is the only thing the player has to go on here.
  // Everything else (move, dock, jump, attack, capture, hack, cease-fire, mine)
  // records an intent and moves nothing, and keeps the raw backend message: it is
  // more specific than any line we could write for it. Since TASK-185 that message
  // is Russian — «слишком далеко для стыковки», not «out of dock range» — and the
  // 5xx branch no longer hands a Go error through either (the handlers log it and
  // answer one line), so «keeps the backend message» no longer means «shows the
  // player English». That is what makes this the right default here rather than a
  // compromise: the panel and the journal both print it.
  const run = (action: Promise<unknown>, toText: (err: unknown) => string = formatError) => {
    setPending(true);
    setError(null);
    action
      .then(() => {
        setPending(false);
        onActionDone?.();
      })
      .catch((err: unknown) => {
        setPending(false);
        const msg = toText(err);
        setError(msg);
        emitLog({ category: 'system', kind: 'danger', message: msg });
      });
  };

  const doMove = () => {
    // Pass the EntityRef so the server records the persistent highlight
    // target. Gate clicks here are a "fly to coords" without a typed ref
    // (gates aren't an EntityKind on the backend); use sendJump's
    // affordance instead for the typed action.
    const ref: EntityRef | undefined =
      target.kind === 'ship'
        ? { kind: EntityKind.Ship, id: target.id }
        : target.kind === 'dock'
          ? target.ref
          : undefined;
    run(sendMove(ownShipID, target.x, target.y, ref));
  };
  const doDock = () => {
    if (target.kind !== 'dock') return;
    run(sendDock(ownShipID, target.ref));
  };
  const doJump = () => {
    if (target.kind !== 'gate') return;
    run(sendJump(ownShipID, target.id));
  };
  const doAttack = () => {
    if (target.kind !== 'ship') return;
    run(sendAttack(ownShipID, { kind: EntityKind.Ship, id: target.id }));
  };
  const doShootTorpedo = () => {
    if (target.kind !== 'torpedo') return;
    run(sendAttack(ownShipID, { kind: EntityKind.Torpedo, id: target.id }));
  };
  const doCeaseFire = () => {
    run(sendCeaseFire(ownShipID));
  };
  const doCapture = () => {
    if (target.kind !== 'ship') return;
    run(sendCapture(ownShipID, { kind: EntityKind.Ship, id: target.id }));
  };
  const doHack = () => {
    if (target.kind !== 'dock') return;
    run(sendHack(ownShipID, target.ref));
  };
  const doLaunchMissile = (missileClass: number) => {
    if (!missileRef) return;
    run(sendLaunchMissile(ownShipID, missileRef, missileClass), commandErrorText);
  };
  const doLaunchDrones = () => {
    // Drones stay ship-only (TASK-113 C-03) — the server rejects a static target.
    if (target.kind !== 'ship') return;
    // No count: the server launches what up_drone_control runs, clamped to the hold
    // (TASK-176). This menu has no cargo of its own — which is exactly why it used
    // to send a fixed salvo of 3 and get a 400 whenever fewer were aboard — and the
    // journal line is how the player learns how many actually flew.
    run(launchDronesReported(ownShipID, { kind: EntityKind.Ship, id: target.id }), commandErrorText);
  };
  const doLaunchTorpedo = (torpedoClass: number) => {
    if (!weaponRef) return;
    run(sendLaunchTorpedo(ownShipID, weaponRef, torpedoClass), commandErrorText);
  };
  const doRecallDrones = () => {
    run(recallDronesReported(ownShipID));
  };
  const doDismantle = () => {
    if (target.kind !== 'dock') return;
    run(
      sendDismantleStatic(ownShipID, target.ref).then(() => {
        onCargoChanged?.();
        emitLog({
          category: 'sector',
          kind: 'good',
          message: `${target.label}: объект демонтирован, груз вернулся в трюм.`,
        });
      }),
      commandErrorText,
    );
  };
  const doPickup = () => {
    if (target.kind !== 'container') return;
    run(sendPickupContainer(ownShipID, target.id), commandErrorText);
  };
  const doMine = () => {
    if (target.kind !== 'asteroid') return;
    run(sendMine(ownShipID, target.id));
  };
  const doStopMine = () => {
    // asteroidID 0 is the stop request — clears the ship's mining mode. Shown
    // only when this asteroid is the ship's current MiningTarget (phase
    // 10.3.21), so «Бурить» and «Прекратить добычу» form one state-driven
    // toggle (mirrors «Атаковать»/«Прекратить огонь»).
    run(sendMine(ownShipID, 0));
  };

  return (
    <div className={cx('sw-menu', className)} role="menu">
      <div className="sw-menu__head">
        {target.kind === 'ship' && target.relation && (
          <span className="sw-menu__relation" style={{ background: relationColor(target.relation) }} aria-hidden />
        )}
        {target.label}
      </div>
      <button
        type="button"
        role="menuitem"
        className="sw-menu__item"
        onClick={doMove}
        disabled={baseDisabled}
      >
        Лететь
      </button>
      {target.kind === 'dock' && isDockableStaticKind(target.ref.kind) && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doDock}
          disabled={baseDisabled || !canDock}
          title={!canDock ? 'Слишком далеко для стыковки' : undefined}
        >
          ⚓ Стыковка
        </button>
      )}
      {canHackTarget && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doHack}
          disabled={baseDisabled || !hasHack}
          title={!hasHack ? 'Нужен взломщик (up_hack)' : undefined}
        >
          ⚿ Взломать
        </button>
      )}
      {target.kind === 'torpedo' && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doShootTorpedo}
          disabled={baseDisabled}
          title={target.own ? 'Сбить свою торпеду (отмена пуска)' : 'Навести лазер на торпеду'}
        >
          ✶ Сбить торпеду
        </button>
      )}
      {canDismantle && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doDismantle}
          disabled={baseDisabled}
          title="Свернуть объект и вернуть его в трюм"
        >
          ⤓ Демонтировать
        </button>
      )}
      {target.kind === 'gate' && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doJump}
          disabled={baseDisabled || !canJump}
          title={!canJump ? 'Слишком далеко от ворот' : undefined}
        >
          ⚡ Прыжок
        </button>
      )}
      {target.kind === 'ship' && !isOwnShip && !isCurrentlyAttacking && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doAttack}
          disabled={baseDisabled}
        >
          ✶ Атаковать
        </button>
      )}
      {target.kind === 'ship' && isCurrentlyAttacking && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doCeaseFire}
          disabled={baseDisabled}
        >
          ◇ Прекратить огонь
        </button>
      )}
      {canLaunchMissile &&
        MISSILE_CLASSES.map(({ cls, name, goods }) => (
          <button
            key={cls}
            type="button"
            role="menuitem"
            className="sw-menu__item sw-menu__item--missile"
            onClick={() => doLaunchMissile(cls)}
            disabled={baseDisabled || !hasLauncher}
            title={
              !hasLauncher
                ? 'Нужна пусковая установка (up_launcher)'
                : target.kind === 'container'
                  ? `Уничтожить контейнер вместе с грузом — боеприпас «${name}» (gt${goods})`
                  : `Боеприпас «${name}» (gt${goods}), класс ${cls}`
            }
          >
            ◈ Ракета: {name}
          </button>
        ))}
      {target.kind === 'ship' && !isOwnShip && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doLaunchDrones}
          disabled={baseDisabled || !hasDroneControl}
          title={!hasDroneControl ? 'Нужен контроль дронов (up_drone_control)' : undefined}
        >
          ⬡ Запустить дронов
        </button>
      )}
      {target.kind === 'ship' && !isOwnShip && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doCapture}
          disabled={baseDisabled || !hasCapture || captureTargetFriendly || captureShieldUp}
          title={captureTitle}
        >
          ⚑ Захватить
        </button>
      )}
      {canTargetWeapon && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={() => doLaunchTorpedo(TORPEDO_CLASS_FIRESTORM)}
          disabled={baseDisabled || !hasTorpedoLauncher}
          title={!hasTorpedoLauncher ? 'Нужна торпедная установка (up_torpedo_launcher)' : 'Боеприпас «Огненная Буря» (gt23)'}
        >
          ☄ Торпеда: Огненная Буря
        </button>
      )}
      {canTargetWeapon && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={() => doLaunchTorpedo(TORPEDO_CLASS_HOLY)}
          disabled={baseDisabled || !hasTorpedoLauncher}
          title={!hasTorpedoLauncher ? 'Нужна торпедная установка (up_torpedo_launcher)' : 'Боеприпас «Святая Торпеда» (gt24)'}
        >
          ☄ Торпеда: Святая Торпеда
        </button>
      )}
      {target.kind === 'ship' && isOwnShip && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doRecallDrones}
          disabled={baseDisabled}
        >
          ⬡ Вернуть дронов
        </button>
      )}
      {target.kind === 'container' && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doPickup}
          disabled={baseDisabled}
          title="Корабль должен быть рядом с контейнером"
        >
          ⬚ Подобрать
        </button>
      )}
      {target.kind === 'asteroid' && !isCurrentlyMining && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doMine}
          disabled={baseDisabled || !hasDrill}
          title={!hasDrill ? 'Нужен бур (up_drill)' : 'Корабль должен быть рядом с астероидом'}
        >
          ⛏ Бурить
        </button>
      )}
      {target.kind === 'asteroid' && isCurrentlyMining && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item"
          onClick={doStopMine}
          disabled={baseDisabled}
        >
          ◇ Прекратить добычу
        </button>
      )}
      {error && <div className="sw-menu__error">{error}</div>}
    </div>
  );
}

function cx(...parts: (string | undefined | null | false)[]): string {
  return parts.filter(Boolean).join(' ');
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
