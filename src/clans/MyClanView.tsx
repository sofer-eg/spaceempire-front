import { useEffect, useState } from 'react';
import { fetchPlayers, type PlayerSummary } from '../api';
import {
  inviteToClan,
  kickMember,
  leaveClan,
  setMemberRole,
  type ClanDetail,
} from './clansApi';

type Props = {
  clan: ClanDetail;
  ownPlayerID: number;
  onChanged: () => void;
};

const roleLabel: Record<string, string> = {
  leader: 'Лидер',
  officer: 'Офицер',
  member: 'Член',
};

// MyClanView is the management screen for the clan the player belongs to:
// member roster, leader-only invite/kick controls, and Leave.
export function MyClanView({ clan, ownPlayerID, onChanged }: Props) {
  const myRole = clan.members.find((m) => m.playerId === ownPlayerID)?.role;
  const isManager = myRole === 'leader' || myRole === 'officer';
  const isLeader = myRole === 'leader';

  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [inviteTarget, setInviteTarget] = useState<number>(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isManager) return;
    let alive = true;
    void fetchPlayers()
      .then((ps) => {
        if (alive) setPlayers(ps);
      })
      .catch(() => {
        /* invite dropdown stays empty on failure — non-fatal */
      });
    return () => {
      alive = false;
    };
  }, [isManager]);

  const memberIDs = new Set(clan.members.map((m) => m.playerId));
  const invitedIDs = new Set(clan.invitations.map((i) => i.playerId));
  const invitable = players.filter(
    (p) => !memberIDs.has(p.playerID) && !invitedIDs.has(p.playerID),
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-panel sw-clan">
      <div className="sw-panel-head">
        <span className="title">
          {clan.name} <span className="sw-chip">{clan.tag}</span>
        </span>
        <div className="sw-row" style={{ gap: 6 }}>
          <span className="sw-chip dot good">{roleLabel[myRole ?? 'member']}</span>
          <span className="sw-chip">{clan.members.length} участн.</span>
        </div>
      </div>

      <div className="sw-panel-body">
        <table className="sw-table">
          <thead>
            <tr>
              <th>Пилот</th>
              <th>Роль</th>
              {isManager && <th />}
            </tr>
          </thead>
          <tbody>
            {clan.members.map((m) => (
              <tr key={m.playerId}>
                <td>
                  {m.login}
                  {m.playerId === ownPlayerID && <span className="sw-chip" style={{ marginLeft: 6 }}>вы</span>}
                </td>
                <td>{roleLabel[m.role] ?? m.role}</td>
                {isManager && (
                  <td style={{ textAlign: 'right' }}>
                    {m.role !== 'leader' && m.playerId !== ownPlayerID && (
                      <div className="sw-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {isLeader && m.role === 'member' && (
                          <button
                            type="button"
                            className="sw-btn ghost"
                            disabled={busy}
                            onClick={() => void run(() => setMemberRole(clan.id, m.playerId, 'officer'))}
                          >
                            В офицеры
                          </button>
                        )}
                        {isLeader && m.role === 'officer' && (
                          <button
                            type="button"
                            className="sw-btn ghost"
                            disabled={busy}
                            onClick={() => void run(() => setMemberRole(clan.id, m.playerId, 'member'))}
                          >
                            Разжаловать
                          </button>
                        )}
                        <button
                          type="button"
                          className="sw-btn ghost"
                          disabled={busy}
                          onClick={() => void run(() => kickMember(clan.id, m.playerId))}
                        >
                          Исключить
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {clan.invitations.length > 0 && (
          <div className="sw-clan__section">
            <div className="sw-clan__subhead">Приглашения отправлены</div>
            <ul className="sw-clan__list">
              {clan.invitations.map((i) => (
                <li key={i.playerId} className="sw-mono">
                  {i.login}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isManager && (
          <div className="sw-clan__section">
            <div className="sw-clan__subhead">Пригласить пилота</div>
            <div className="sw-row" style={{ gap: 8 }}>
              <select
                className="sw-input"
                value={inviteTarget}
                onChange={(e) => setInviteTarget(Number(e.target.value))}
              >
                <option value={0}>— выбрать пилота —</option>
                {invitable.map((p) => (
                  <option key={p.playerID} value={p.playerID}>
                    {p.login}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="sw-btn"
                disabled={busy || inviteTarget === 0}
                onClick={() =>
                  void run(async () => {
                    await inviteToClan(clan.id, inviteTarget);
                    setInviteTarget(0);
                  })
                }
              >
                Пригласить
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="sw-panel-head" style={{ borderTop: '1px solid var(--sw-line, #1d2733)', borderBottom: 'none' }}>
        {error && <span className="sw-form__status error">{error}</span>}
        <div className="sw-spacer" />
        <button
          type="button"
          className="sw-btn danger"
          disabled={busy}
          onClick={() => void run(() => leaveClan(clan.id))}
        >
          Покинуть клан
        </button>
      </div>
    </div>
  );
}
