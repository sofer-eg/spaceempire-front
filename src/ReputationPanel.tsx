import { useEffect, useState } from 'react';
import { fetchRaceStandings, type Race, type RaceStanding } from './api';
import { raceColor, raceName } from './gameContext';

// ReputationPanel shows the player's standing with each main race (1-5) and a
// "WANTED" badge when a race's police are after them (phase 9.4). It refetches
// on mount and whenever refreshSeq changes — useWorldState bumps that on every
// police_scan frame, so a confiscation updates the panel without polling.
export function ReputationPanel({ races, refreshSeq }: { races: Race[]; refreshSeq: number }) {
  const [standings, setStandings] = useState<RaceStanding[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchRaceStandings();
        if (!cancelled) setStandings(res.items);
      } catch (err) {
        console.error('fetchRaceStandings', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSeq]);

  const anyWanted = standings.some((s) => s.wanted);

  return (
    <div className="sw-panel">
      <div className="sw-panel-head">
        <span className="title">Репутация</span>
        {anyWanted ? (
          <span className="sw-chip dot danger">WANTED</span>
        ) : (
          <span className="meta">РАСЫ</span>
        )}
      </div>
      <div className="sw-panel-body">
        {standings.length === 0 ? (
          <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
            Нет данных.
          </span>
        ) : (
          <div className="sw-col" style={{ gap: 6 }}>
            {standings.map((s) => (
              <div
                key={s.race}
                className="sw-row"
                style={{ justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="sw-row" style={{ gap: 6, alignItems: 'center' }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: raceColor(races, s.race, 'var(--ink-mute)'),
                    }}
                  />
                  <span className="sw-mono" style={{ fontSize: 12 }}>
                    {raceName(races, s.race) || `Раса ${s.race}`}
                  </span>
                </span>
                <span className="sw-row" style={{ gap: 6, alignItems: 'center' }}>
                  <span className="sw-mono" style={{ fontSize: 12, color: standingColor(s.standing) }}>
                    {s.standing > 0 ? `+${s.standing}` : s.standing}
                  </span>
                  {s.wanted && (
                    <span className="sw-chip dot danger" style={{ fontSize: 9 }}>
                      WANTED
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// standingColor maps a standing value to a HUD token: red when wanted-deep,
// amber when negative, green when positive, muted at neutral.
function standingColor(v: number): string {
  if (v <= -10) return 'var(--danger)';
  if (v < 0) return 'var(--warn)';
  if (v > 0) return 'var(--good)';
  return 'var(--ink-mute)';
}
