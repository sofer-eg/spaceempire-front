import { useCallback, useEffect, useState } from 'react';
import { useGameContext } from '../gameContext';
import { ClansView } from './ClansView';
import { MyClanView } from './MyClanView';
import {
  acceptInvite,
  createClan,
  fetchMyClan,
  fetchMyInvites,
  type ClanDetail,
  type ClanInvitation,
} from './clansApi';

// ClansPage is the /clans route. When the player belongs to a clan it shows
// the management view; otherwise it shows the "lobby": pending invitations
// to accept, a create-clan form, and the browsable list of all clans.
export function ClansPage() {
  const { ownPlayerID } = useGameContext();
  const [myClan, setMyClan] = useState<ClanDetail | null>(null);
  const [invites, setInvites] = useState<ClanInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // No setState before the first await — the loading flag starts true and is
  // cleared in finally, so the mount effect never triggers a synchronous
  // render (react-hooks/set-state-in-effect). Refreshes after an action
  // simply update in place without a loading flash.
  const reload = useCallback(async () => {
    try {
      const [clan, inv] = await Promise.all([fetchMyClan(), fetchMyInvites()]);
      setMyClan(clan);
      setInvites(inv);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount fetch is inlined (not a reload() call) so setState happens only
  // inside the promise callbacks — calling a known state-setter synchronously
  // in the effect body trips react-hooks/set-state-in-effect.
  useEffect(() => {
    let alive = true;
    Promise.all([fetchMyClan(), fetchMyInvites()])
      .then(([clan, inv]) => {
        if (!alive) return;
        setMyClan(clan);
        setInvites(inv);
        setError('');
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="sw-clans-page">
      {loading && <div className="sw-station__loader">Загрузка…</div>}
      {!loading && error && <div className="sw-form__status error">{error}</div>}

      {!loading && !error && myClan && (
        <MyClanView clan={myClan} ownPlayerID={ownPlayerID} onChanged={() => void reload()} />
      )}

      {!loading && !error && !myClan && (
        <>
          {invites.length > 0 && (
            <div className="sw-panel sw-clan">
              <div className="sw-panel-head">
                <span className="title">Приглашения</span>
              </div>
              <div className="sw-panel-body">
                <ul className="sw-clan__list">
                  {invites.map((i) => (
                    <li key={i.clanId} className="sw-row" style={{ gap: 8, alignItems: 'center' }}>
                      <span>
                        {i.clanName} <span className="sw-chip">{i.clanTag}</span>
                      </span>
                      <div className="sw-spacer" />
                      <button
                        type="button"
                        className="sw-btn"
                        onClick={() =>
                          void acceptInvite(i.clanId)
                            .then(() => reload())
                            .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                        }
                      >
                        Принять
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <CreateClanForm onCreated={() => void reload()} />
          <ClansView />
        </>
      )}
    </section>
  );
}

function CreateClanForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await createClan(name.trim(), tag.trim());
      setName('');
      setTag('');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-panel sw-clan">
      <div className="sw-panel-head">
        <span className="title">Основать клан</span>
      </div>
      <div className="sw-panel-body">
        <div className="sw-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            className="sw-input"
            placeholder="Название (3–32)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <input
            className="sw-input"
            placeholder="Тег (2–6)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            style={{ maxWidth: 120 }}
          />
          <button type="button" className="sw-btn" disabled={busy || !name.trim() || !tag.trim()} onClick={() => void submit()}>
            Создать
          </button>
        </div>
        {error && <div className="sw-form__status error" style={{ marginTop: 8 }}>{error}</div>}
      </div>
    </div>
  );
}
