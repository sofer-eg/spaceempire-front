import { useState } from 'react';
import { boardShip, type EntityRef } from '../api';
import { shipDisplayName, useGameContext } from '../gameContext';

// HangarView lists every ship docked at the current station (phase 10.23) and
// lets a player in a spacesuit board one: their own ship (take control), an NPC
// ship, or another player's open ship (ride as a passenger). Closed ships of
// other players show a disabled "вход закрыт". The docked ships are already in
// the sector snapshot (the suit sits at the station, so they share its AOI), so
// this is a pure client-side filter — no extra endpoint.
export function HangarView({ station }: { station: EntityRef }) {
  const { ships, ownShip, ownPlayerID, races, logins, refreshPlayer } = useGameContext();
  const [busy, setBusy] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const inSuit = ownShip?.isSpacesuit === true;

  const docked = [...ships.values()].filter(
    (s) =>
      s.docked != null &&
      s.docked.kind === station.kind &&
      s.docked.id === station.id &&
      s.id !== ownShip?.id, // not the player's own suit
  );

  const onBoard = async (targetID: number) => {
    setBusy(targetID);
    setError(null);
    try {
      await boardShip(targetID);
      void refreshPlayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сесть на корабль');
    } finally {
      setBusy(0);
    }
  };

  return (
    <div className="sw-col" style={{ gap: 10, padding: 12 }}>
      {!inSuit && (
        <span style={{ color: 'var(--warn, #d8a657)', fontSize: 12 }}>
          Чтобы пересесть на другой корабль, сначала выйдите в скафандре («Покинуть корабль»).
        </span>
      )}
      {error && <span style={{ color: 'var(--danger, #e06c75)' }}>{error}</span>}
      {docked.length === 0 ? (
        <span style={{ color: 'var(--muted, #7a8a99)' }}>В ангаре нет кораблей.</span>
      ) : (
        docked.map((s) => {
          const mine = s.playerID === ownPlayerID;
          const owner = mine
            ? 'свой'
            : s.isNPC
              ? null
              : logins.get(s.playerID) ?? `#${s.playerID}`;
          const label = owner ? `${shipDisplayName(s, races)} · ${owner}` : shipDisplayName(s, races);

          // Board affordance: own → control; NPC/open → passenger; else closed.
          const boardable = mine || s.isNPC === true || s.isOpen === true;
          const actionText = mine ? 'Сесть' : 'Сесть пассажиром';

          return (
            <div key={s.id} className="sw-row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 600 }}>{label}</span>
              {s.isSpacesuit && <span className="sw-chip dot danger">СКАФАНДР</span>}
              <div className="sw-spacer" />
              {boardable ? (
                <button
                  type="button"
                  className="sw-btn"
                  disabled={!inSuit || busy === s.id}
                  title={inSuit ? actionText : 'Выйдите из корабля, чтобы пересесть'}
                  onClick={() => void onBoard(s.id)}
                >
                  {actionText}
                </button>
              ) : (
                <span className="sw-chip dot warn" title="Владелец закрыл вход">
                  вход закрыт
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
