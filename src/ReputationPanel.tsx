import { useEffect, useState } from 'react';
import { fetchRaceStandings, friendlyError, type Race, type RaceStanding } from './api';
import { raceColor, raceName } from './gameContext';

// ReputationPanel shows the player's standing with each main race (1-5) and a
// "WANTED" badge when a race's police are after them (phase 9.4). It refetches
// on mount and whenever refreshSeq changes — useWorldState bumps that on every
// police_scan frame, so a confiscation updates the panel without polling.
export function ReputationPanel({ races, refreshSeq }: { races: Race[]; refreshSeq: number }) {
  // null = the first fetch has not answered yet. Until TASK-187 this was an
  // empty array and the body printed «Нет данных.» for all three of loading, a
  // genuinely empty list and a failed fetch — the player could not tell «you
  // have no reputation anywhere» from «we could not read it».
  const [standings, setStandings] = useState<RaceStanding[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchRaceStandings();
        if (cancelled) return;
        setStandings(res.items);
        setLoadError(null);
      } catch (err) {
        // Deliberately NOT cleared at the start of a refetch (the TASK-168 flee
        // trap): this effect re-runs on every police_scan frame, and a single one
        // is enough to blank the message and put the panel back on «Загрузка…»
        // while the player is still reading it. Frames are not periodic and not a
        // poll — the backend publishes one only when a scan actually confiscates
        // something, under a per-target cooldown (internal/sector/police.go) — so
        // this is about one badly-timed frame, not a stream of them. A refetch that
        // succeeds clears the message; one that fails again rewrites the same line,
        // so the failure stays on screen for as long as it lasts.
        if (!cancelled) setLoadError(friendlyError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSeq]);

  const rows = standings ?? [];
  const anyWanted = rows.some((s) => s.wanted);

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
        {/* Three states, one per line of this chain: a failed read says so (and
            keeps the last good list underneath it — stale numbers still beat a
            blank panel), a first fetch that has not answered says «Загрузка…»,
            and only a list that really came back empty says «Нет данных.». */}
        {loadError !== null && (
          <span className="sw-mono" style={{ color: 'var(--danger)', fontSize: 11 }}>
            {loadError}
          </span>
        )}
        {loadError === null && standings === null && (
          <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
            Загрузка…
          </span>
        )}
        {loadError === null && standings !== null && rows.length === 0 && (
          <span className="sw-mono" style={{ color: 'var(--ink-mute)', fontSize: 11 }}>
            Нет данных.
          </span>
        )}
        {rows.length > 0 && (
          <div className="sw-col" style={{ gap: 6, marginTop: loadError !== null ? 6 : 0 }}>
            {rows.map((s) => (
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
