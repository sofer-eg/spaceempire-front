import { useCallback, useEffect, useState } from 'react';
import { useGameContext } from '../gameContext';
import {
  buyInsurance,
  fetchMyPolicies,
  CoveragePreviewMultiplier,
  type InsurancePolicy,
} from './insuranceApi';

// InsuranceView is the "Страховка" tab of the docked StationView (phase 6.5):
// shows the current ship's active policy (if any) with its expiry, and a form
// to buy cover. Payout on destruction is handled server-side off the kill bus.
export function InsuranceView({ shipID }: { shipID: number }) {
  const { refreshPlayer } = useGameContext();
  const [policies, setPolicies] = useState<InsurancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const all = await fetchMyPolicies();
    setPolicies(all);
    setError('');
  }, []);

  useEffect(() => {
    let alive = true;
    fetchMyPolicies()
      .then((all) => {
        if (alive) {
          setPolicies(all);
          setError('');
        }
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

  const active = policies.find((p) => p.shipId === shipID && p.status === 'active');

  const onBought = useCallback(() => {
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshPlayer();
  }, [reload, refreshPlayer]);

  return (
    <div className="sw-station__insurance">
      {loading && <div className="sw-station__empty">Загрузка…</div>}
      {!loading && error && <div className="sw-form__status error">{error}</div>}
      {!loading && (
        <>
          {active ? (
            <div className="sw-panel-body">
              <div className="sw-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="sw-chip dot good">ЗАСТРАХОВАН</span>
                <span>
                  покрытие <b>{active.coverage.toLocaleString('ru-RU')}</b> кр.
                </span>
                <span className="sw-chip">до {new Date(active.expiresAt).toLocaleString('ru-RU')}</span>
              </div>
            </div>
          ) : (
            <BuyInsuranceForm shipID={shipID} onBought={onBought} />
          )}
        </>
      )}
    </div>
  );
}

function BuyInsuranceForm({ shipID, onBought }: { shipID: number; onBought: () => void }) {
  const [premium, setPremium] = useState('');
  const [days, setDays] = useState('30');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const premiumNum = Number(premium);
  const daysNum = Number(days);
  const valid = Number.isFinite(premiumNum) && premiumNum > 0 && Number.isFinite(daysNum) && daysNum > 0;
  const coveragePreview = valid ? Math.floor(premiumNum) * CoveragePreviewMultiplier : 0;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await buyInsurance(shipID, Math.floor(premiumNum), Math.floor(daysNum));
      setPremium('');
      onBought();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sw-panel-body">
      <div className="sw-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="sw-input"
          type="number"
          min={1}
          placeholder="Премия, кр."
          value={premium}
          onChange={(e) => setPremium(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        <input
          className="sw-input"
          type="number"
          min={1}
          placeholder="Дней"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          style={{ maxWidth: 100 }}
        />
        <span className="sw-chip">покрытие ≈ {coveragePreview.toLocaleString('ru-RU')} кр.</span>
        <button type="button" className="sw-btn" disabled={busy || !valid} onClick={() => void submit()}>
          Застраховать
        </button>
      </div>
      {error && (
        <div className="sw-form__status error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
