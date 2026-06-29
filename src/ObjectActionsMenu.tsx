import { useState } from 'react';
import {
  EntityKind,
  sendAttack,
  sendCeaseFire,
  sendDock,
  sendJump,
  sendLaunchDrone,
  sendLaunchMissile,
  sendLaunchTorpedo,
  sendMine,
  sendMove,
  sendPickupContainer,
  sendRecallDrones,
  type EntityRef,
  type InstalledEquipment,
} from './api';
import { emitLog } from './eventBus';
import { relationColor, type Relation } from './sector/shapeData';

// DRONE_SALVO is how many drones one "launch drones" action sends. A
// small fixed salvo keeps the action one click; a dedicated count picker
// can come later.
const DRONE_SALVO = 3;

// Torpedo ammunition classes (ЧТЗ doc-1 §3): 2 = «Огненная Буря» (gt23),
// 3 = «Святая Торпеда» (gt24). The on-canvas menu offers one button per class,
// gated on the launcher module; the hold-count gate lives in CombatHUD (which
// has the cargo), mirroring how the missile item here gates on launcher only.
const TORPEDO_CLASS_FIRESTORM = 2;
const TORPEDO_CLASS_HOLY = 3;

// PickedObject is the unified target type shared by TargetsPanel (rows) and
// SectorCanvas (click-on-object). It carries everything the action menu
// needs to render and to issue the right backend command — world coords for
// distance gating and sendMove, EntityRef for sendDock, gate id for
// sendJump.
export type PickedObject =
  | { kind: 'ship'; id: number; x: number; y: number; label: string; relation?: Relation }
  | { kind: 'gate'; id: number; x: number; y: number; label: string }
  | { kind: 'dock'; ref: EntityRef; x: number; y: number; label: string; letter?: string }
  | { kind: 'container'; id: number; x: number; y: number; label: string }
  // asteroid carries the human-readable ore label and remaining mass so the
  // menu head reads "Руда · 240" rather than a raw ore_type id (phase 10.3.6).
  | { kind: 'asteroid'; id: number; x: number; y: number; label: string };

type Props = {
  target: PickedObject;
  // ownShipID is the ship that will execute the command. 0 disables every
  // action — the player has no ship in this sector yet.
  ownShipID: number;
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
  // onActionDone fires after a command resolves successfully so the parent
  // can dismiss the popover. Failures keep the menu open and surface the
  // error inline.
  onActionDone?: () => void;
};

export function ObjectActionsMenu({
  target,
  ownShipID,
  ownShip,
  ownShipAttackTargetID,
  ownShipMiningTargetID,
  ownEquipment,
  dockRange,
  gateRange,
  className,
  onActionDone,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dist = ownShip
    ? Math.hypot(ownShip.x - target.x, ownShip.y - target.y)
    : Number.POSITIVE_INFINITY;
  const canDock = target.kind === 'dock' && dist <= dockRange;
  const canJump = target.kind === 'gate' && dist <= gateRange;
  const isOwnShip = target.kind === 'ship' && target.id === ownShipID;
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

  const run = (action: Promise<unknown>) => {
    setPending(true);
    setError(null);
    action
      .then(() => {
        setPending(false);
        onActionDone?.();
      })
      .catch((err: unknown) => {
        setPending(false);
        const msg = formatError(err);
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
  const doCeaseFire = () => {
    run(sendCeaseFire(ownShipID));
  };
  const doLaunchMissile = () => {
    if (target.kind !== 'ship') return;
    run(sendLaunchMissile(ownShipID, { kind: EntityKind.Ship, id: target.id }));
  };
  const doLaunchDrones = () => {
    if (target.kind !== 'ship') return;
    run(sendLaunchDrone(ownShipID, { kind: EntityKind.Ship, id: target.id }, DRONE_SALVO));
  };
  const doLaunchTorpedo = (torpedoClass: number) => {
    if (target.kind !== 'ship') return;
    run(sendLaunchTorpedo(ownShipID, { kind: EntityKind.Ship, id: target.id }, torpedoClass));
  };
  const doRecallDrones = () => {
    run(sendRecallDrones(ownShipID));
  };
  const doPickup = () => {
    if (target.kind !== 'container') return;
    run(sendPickupContainer(ownShipID, target.id));
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
      {target.kind === 'dock' && target.ref.kind !== EntityKind.Satellite && (
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
      {target.kind === 'ship' && !isOwnShip && (
        <button
          type="button"
          role="menuitem"
          className="sw-menu__item sw-menu__item--missile"
          onClick={doLaunchMissile}
          disabled={baseDisabled || !hasLauncher}
          title={!hasLauncher ? 'Нужна пусковая установка (up_launcher)' : undefined}
        >
          ◈ Запустить ракету
        </button>
      )}
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
          onClick={() => doLaunchTorpedo(TORPEDO_CLASS_FIRESTORM)}
          disabled={baseDisabled || !hasTorpedoLauncher}
          title={!hasTorpedoLauncher ? 'Нужна торпедная установка (up_torpedo_launcher)' : 'Боеприпас «Огненная Буря» (gt23)'}
        >
          ☄ Торпеда: Огненная Буря
        </button>
      )}
      {target.kind === 'ship' && !isOwnShip && (
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
