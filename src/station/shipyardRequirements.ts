// Pure install-requirement logic for the shipyard outfit gate (TASK-100.3.28).
// DOM-free and dependency-free (only type-only imports from ./api, stripped at
// runtime) so it can be unit-tested with the Node built-in runner
// (`npm run test`, i.e. `node --test`) and reused by both the render and the
// button-disabled state in ShipyardView without duplicating the logic.
import type { Equipment, Race } from '../api';

// InstallReqContext carries everything installRequirements needs beyond the
// catalog and the module itself. repKnown distinguishes «standings loaded» from
// «standings unknown» (fetch failed): when unknown, the reputation axes are not
// gated at all and the server 422 is the fallback — avoiding a fabricated
// «(у вас 0)» and a false block.
export type InstallReqContext = {
  installedTypes: Set<string>;
  repKnown: boolean;
  races: Race[];
  shipyardRace: number;
  raceStanding: number;
  warRate: number;
  tradeRate: number;
};

// installRequirements lists a module's unmet install prerequisites as
// human-readable strings — the missing dependency and, when standings are
// known, any reputation axis below its threshold. It mirrors the server gate
// (equipment_effects.go ResolveInstall): each axis uses a strict `<` with NO
// «threshold > 0» guard, so a negative standing blocks a 0-threshold axis
// exactly as the server does (avoiding a surprise 422). Credit shortage is NOT
// a requirement line — the caller handles it separately.
export function installRequirements(
  catalog: Equipment[],
  e: Equipment,
  ctx: InstallReqContext,
): string[] {
  const reqs: string[] = [];
  const dep = e.dependance;
  if (dep !== '' && dep !== 'none' && !ctx.installedTypes.has(dep)) {
    reqs.push(`Сначала установите: ${depLabel(catalog, dep)}`);
  }
  // Only gate on reputation when we actually know the player's standings; an
  // unknown value must not masquerade as 0 and block a module the player may
  // well qualify for (the server re-checks and returns 422 if not).
  if (ctx.repKnown) {
    if (ctx.raceStanding < e.minRaceRate) {
      const rn = raceLabel(ctx.races, ctx.shipyardRace) || 'верфи';
      reqs.push(`Нужен ранг с расой ${rn} ≥ ${e.minRaceRate} (у вас ${ctx.raceStanding})`);
    }
    if (ctx.warRate < e.minWarRate) {
      reqs.push(`Нужен боевой ранг ≥ ${e.minWarRate} (у вас ${ctx.warRate})`);
    }
    if (ctx.tradeRate < e.minTradeRate) {
      reqs.push(`Нужен торговый ранг ≥ ${e.minTradeRate} (у вас ${ctx.tradeRate})`);
    }
  }
  return reqs;
}

// depLabel resolves a dependency type key (e.g. up_accumulator) to a human
// label via the first catalog row of that type, falling back to the raw key.
export function depLabel(catalog: Equipment[], type: string): string {
  return catalog.find((e) => e.type === type)?.description ?? type;
}

// raceLabel returns the display name for a race id, or '' when neutral (0) /
// unknown. Inlined (mirrors gameContext.raceName) to keep this module free of
// the React/router imports gameContext pulls in.
function raceLabel(races: Race[], id: number): string {
  if (!id) return '';
  return races.find((r) => r.id === id)?.name ?? '';
}
