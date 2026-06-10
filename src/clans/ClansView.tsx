import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchClans, type ClanSummary } from './clansApi';

// ClansView lists every clan with its member count. A row opens the
// read-only detail at /clans/:id. Joining is invite-only, so there is no
// join action here.
export function ClansView() {
  const navigate = useNavigate();
  const [clans, setClans] = useState<ClanSummary[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void fetchClans()
      .then((cs) => {
        if (alive) setClans(cs);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? clans.filter((c) => c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q))
    : clans;

  return (
    <div className="sw-panel sw-clan">
      <div className="sw-panel-head">
        <span className="title">Все кланы</span>
        <input
          className="sw-input"
          placeholder="поиск по названию / тегу"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />
      </div>
      <div className="sw-panel-body">
        {error && <div className="sw-form__status error">{error}</div>}
        {!error && filtered.length === 0 && (
          <div className="sw-station__empty">
            <span>{clans.length === 0 ? 'Кланов пока нет.' : 'Ничего не найдено.'}</span>
          </div>
        )}
        {filtered.length > 0 && (
          <table className="sw-table">
            <thead>
              <tr>
                <th>Тег</th>
                <th>Название</th>
                <th style={{ textAlign: 'right' }}>Участников</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  className="sw-target-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/clans/${c.id}`)}
                >
                  <td className="sw-mono">{c.tag}</td>
                  <td>{c.name}</td>
                  <td style={{ textAlign: 'right' }}>{c.memberCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
