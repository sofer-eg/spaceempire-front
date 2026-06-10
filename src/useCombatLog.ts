import { useEffect, useRef } from 'react';
import { EntityKind, type DroneImpact, type LaserBeam, type MissileImpact } from './api';
import { emitLog, type LogEvent } from './eventBus';
import type { TrackedShip } from './useWorldState';

// useCombatLog turns the one-frame combat effects of each snapshot
// (laser beams, missile/drone impacts) into human-readable lines in the
// HUD event log. The backend never sends "damage_taken" / "damage_dealt"
// / "entity_killed" as named WS events — it only publishes the impacts
// with a `killed` flag, so the SPA derives the player's perspective here
// by comparing the attacker/owner/target against the own ship id.
//
// We dedupe by tick: the effect runs once per snapshot (tick changes) and
// the impact arrays are replaced wholesale each frame, so each event is
// emitted exactly once. Inputs are mirrored into a ref so the processing
// effect can key purely on `tick` without a stale closure and without
// tripping react-hooks/exhaustive-deps on the per-frame arrays.
type CombatLogInput = {
  tick: number;
  ownShipID: number;
  laserEffects: LaserBeam[];
  missileImpacts: MissileImpact[];
  droneImpacts: DroneImpact[];
  ships: Map<number, TrackedShip>;
  logins: Map<number, string>;
};

export function useCombatLog(input: CombatLogInput): void {
  const ref = useRef(input);
  useEffect(() => {
    ref.current = input;
  });

  const lastTick = useRef(-1);
  useEffect(() => {
    const cur = ref.current;
    if (cur.tick === lastTick.current) return;
    lastTick.current = cur.tick;
    if (cur.ownShipID === 0) return;

    const out: LogEvent[] = [];
    const name = (shipID: number): string => {
      const s = cur.ships.get(shipID);
      if (s && s.playerID !== 0) return cur.logins.get(s.playerID) ?? `#${shipID}`;
      return `#${shipID}`;
    };
    const targetName = (kind: number, id: number): string =>
      kind === EntityKind.Ship ? name(id) : `#${id}`;

    const dealt = (label: string, damage: number, killed: boolean, weapon: string) => {
      out.push(
        killed
          ? { category: 'combat', kind: 'good', message: `✸ ${weapon}: ${label} уничтожен` }
          : { category: 'combat', kind: 'info', message: `${weapon} → ${label}: −${damage}` },
      );
    };
    const taken = (attacker: string, damage: number, killed: boolean, weapon: string) => {
      out.push(
        killed
          ? { category: 'combat', kind: 'danger', message: `✸ Ваш корабль уничтожен (${attacker})` }
          : { category: 'combat', kind: 'warn', message: `${attacker} (${weapon}) по вам: −${damage}` },
      );
    };

    for (const b of cur.laserEffects) {
      if (b.attacker === cur.ownShipID) {
        dealt(targetName(b.target.kind, b.target.id), b.damage, !!b.killed, 'Лазер');
      } else if (b.target.kind === EntityKind.Ship && b.target.id === cur.ownShipID) {
        taken(name(b.attacker), b.damage, !!b.killed, 'лазер');
      }
    }
    for (const m of cur.missileImpacts) {
      const mine = m.attacker === cur.ownShipID;
      const atMe = m.target.kind === EntityKind.Ship && m.target.id === cur.ownShipID;
      if (m.expired) {
        if (mine) out.push({ category: 'combat', kind: 'warn', message: 'Ракета не достигла цели' });
        continue;
      }
      if (mine) dealt(targetName(m.target.kind, m.target.id), m.damage ?? 0, !!m.killed, 'Ракета');
      else if (atMe) taken(name(m.attacker), m.damage ?? 0, !!m.killed, 'ракета');
    }
    for (const d of cur.droneImpacts) {
      if (d.expired) continue;
      const mine = d.owner === cur.ownShipID;
      const atMe = d.target.kind === EntityKind.Ship && d.target.id === cur.ownShipID;
      if (mine) dealt(targetName(d.target.kind, d.target.id), d.damage ?? 0, !!d.killed, 'Дрон');
      else if (atMe) taken(name(d.owner), d.damage ?? 0, !!d.killed, 'дрон');
    }

    for (const e of out) emitLog(e);
  }, [input.tick]);
}
