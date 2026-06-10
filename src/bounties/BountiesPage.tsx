import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGameContext } from '../gameContext';
import { fetchPlayers, type PlayerSummary } from '../api';
import { fetchClans, fetchMyClan, type ClanSummary } from '../clans/clansApi';
import { fetchTopBounties, setBounty, type Bounty } from './bountiesApi';

// BountiesPage is the /bounties route: a public "most wanted" board (top
// active bounties) plus a form to place a new one. Phase 6.3.
export function BountiesPage() {
  const { ownPlayerID, refreshPlayer } = useGameContext();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [clans, setClans] = useState<ClanSummary[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const [b, p, c, mine] = await Promise.all([
      fetchTopBounties(),
      fetchPlayers(),
      fetchClans(),
      fetchMyClan(),
    ]);
    setBounties(b);
    setPlayers(p);
    setClans(c);
    setIsLeader(mine != null && mine.leaderId === ownPlayerID);
    setError('');
  }, [ownPlayerID]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchTopBounties(), fetchPlayers(), fetchClans(), fetchMyClan()])
      .then(([b, p, c, mine]) => {
        if (!alive) return;
        setBounties(b);
        setPlayers(p);
        setClans(c);
        setIsLeader(mine != null && mine.leaderId === ownPlayerID);
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
  }, [ownPlayerID]);

  const onPlaced = useCallback(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshPlayer();
  }, [reload, refreshPlayer]);

  return (
    <section className="sw-clans-page">
      {loading && <div className="sw-station__loader">Загрузка…</div>}
      {!loading && error && <div className="sw-form__status error">{error}</div>}
      {!loading && (
        <>
          <PlaceBountyForm
            players={players.filter((p) => p.playerID !== ownPlayerID)}
            clans={clans}
            isLeader={isLeader}
            onPlaced={onPlaced}
          />
          <TopBountiesBoard bounties={bounties} />
        </>
      )}
    </section>
  );
}

function TopBountiesBoard({ bounties }: { bounties: Bounty[] }) {
  return (
    <div className="sw-panel sw-clan">
      <div className="sw-panel-head">
        <span className="title">Розыск — топ наград</span>
      </div>
      <div className="sw-panel-body">
        {bounties.length === 0 ? (
          <div className="sw-station__empty">Активных наград нет.</div>
        ) : (
          <table className="sw-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Цель</th>
                <th style={{ textAlign: 'right' }}>Награда</th>
                <th style={{ textAlign: 'left' }}>Заказчик</th>
                <th style={{ textAlign: 'left' }}>Истекает</th>
              </tr>
            </thead>
            <tbody>
              {bounties.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.targetName || `#${b.targetId}`}{' '}
                    <span className="sw-chip">{b.targetKind === 'clan' ? 'клан' : 'пилот'}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{b.amount.toLocaleString('ru-RU')} кр.</td>
                  <td>{b.sponsorName || `#${b.sponsorId}`}</td>
                  <td>{new Date(b.expiresAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PlaceBountyForm({
  players,
  clans,
  isLeader,
  onPlaced,
}: {
  players: PlayerSummary[];
  clans: ClanSummary[];
  isLeader: boolean;
  onPlaced: () => void;
}) {
  const [targetKind, setTargetKind] = useState<'player' | 'clan'>('player');
  const [targetId, setTargetId] = useState(0);
  const [amount, setAmount] = useState('');
  const [ttlHours, setTtlHours] = useState('168');
  const [fromClan, setFromClan] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const targets = targetKind === 'player' ? players : clans;
  const targetOptions = useMemo(
    () =>
      targetKind === 'player'
        ? players.map((p) => ({ id: p.playerID, label: p.login }))
        : clans.map((c) => ({ id: c.id, label: `${c.name} [${c.tag}]` })),
    [targetKind, players, clans],
  );

  const amountNum = Number(amount);
  const valid = targetId > 0 && Number.isFinite(amountNum) && amountNum > 0;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await setBounty({
        targetKind,
        targetId,
        amount: Math.floor(amountNum),
        ttlHours: Math.max(0, Math.floor(Number(ttlHours) || 0)),
        fromClan,
      });
      setAmount('');
      setTargetId(0);
      onPlaced();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-panel sw-clan">
      <div className="sw-panel-head">
        <span className="title">Назначить награду</span>
      </div>
      <div className="sw-panel-body">
        <div className="sw-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="sw-input"
            value={targetKind}
            onChange={(e) => {
              setTargetKind(e.target.value as 'player' | 'clan');
              setTargetId(0);
            }}
          >
            <option value="player">На пилота</option>
            <option value="clan">На клан</option>
          </select>
          <select
            className="sw-input"
            value={targetId}
            onChange={(e) => setTargetId(Number(e.target.value))}
            style={{ minWidth: 200 }}
          >
            <option value={0}>{targets.length ? '— выбрать цель —' : '— нет целей —'}</option>
            {targetOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            className="sw-input"
            type="number"
            min={1}
            placeholder="Сумма, кр."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={{ maxWidth: 140 }}
          />
          <input
            className="sw-input"
            type="number"
            min={0}
            title="Срок действия в часах (0 — по умолчанию)"
            placeholder="Часов"
            value={ttlHours}
            onChange={(e) => setTtlHours(e.target.value)}
            style={{ maxWidth: 100 }}
          />
          {isLeader && (
            <label className="sw-row" style={{ gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={fromClan} onChange={(e) => setFromClan(e.target.checked)} />
              из казны клана
            </label>
          )}
          <button type="button" className="sw-btn" disabled={busy || !valid} onClick={() => void submit()}>
            Назначить
          </button>
        </div>
        {error && (
          <div className="sw-form__status error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
