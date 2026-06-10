import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchClan, type ClanDetail } from './clansApi';

const roleLabel: Record<string, string> = {
  leader: 'Лидер',
  officer: 'Офицер',
  member: 'Член',
};

// ClanDetailView is the read-only roster for any clan, reached from the
// clans list. Membership changes happen on the player's own /clans screen.
export function ClanDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clanID = Number(id);
  const validID = Number.isInteger(clanID) && clanID > 0;
  const [clan, setClan] = useState<ClanDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!validID) return;
    let alive = true;
    // setState only inside the async callbacks — never synchronously in the
    // effect body (react-hooks/set-state-in-effect).
    void fetchClan(clanID)
      .then((c) => {
        if (alive) setClan(c);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [clanID, validID]);

  return (
    <section className="sw-clans-page">
      <div className="sw-panel sw-clan">
        <div className="sw-panel-head">
          <button type="button" className="sw-btn ghost" onClick={() => navigate('/clans')}>
            ← Кланы
          </button>
          {clan && (
            <span className="title">
              {clan.name} <span className="sw-chip">{clan.tag}</span>
            </span>
          )}
          <div className="sw-spacer" />
          {clan && <span className="sw-chip">{clan.members.length} участн.</span>}
        </div>
        <div className="sw-panel-body">
          {!validID && <div className="sw-form__status error">Некорректный идентификатор клана.</div>}
          {validID && error && <div className="sw-form__status error">{error}</div>}
          {validID && !error && !clan && <div className="sw-station__loader">Загрузка…</div>}
          {clan && (
            <table className="sw-table">
              <thead>
                <tr>
                  <th>Пилот</th>
                  <th>Роль</th>
                </tr>
              </thead>
              <tbody>
                {clan.members.map((m) => (
                  <tr key={m.playerId}>
                    <td>{m.login}</td>
                    <td>{roleLabel[m.role] ?? m.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
