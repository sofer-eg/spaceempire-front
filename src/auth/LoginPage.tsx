import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthError } from './api';
import { useAuth } from './useAuth';

type Mode = 'login' | 'register';

type LocationState = { from?: string };

// Playable races at registration (phase 10.10). Restricted to 1..5
// (Argon/Boron/Paranid/Split/Teladi) server-side too; the NPC-only
// Pirate/Xenon/Kha'ak are not offered. The starter ship spawns at this
// race's home shipyard and inherits its race / M5 name.
const PLAYABLE_RACES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: 'Аргон' },
  { id: 2, name: 'Борон' },
  { id: 3, name: 'Паранид' },
  { id: 4, name: 'Сплит' },
  { id: 5, name: 'Телади' },
];

export function LoginPage() {
  const { status, login, register } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [race, setRace] = useState(PLAYABLE_RACES[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Already-authenticated users get bounced to wherever they tried to go,
  // or to "/" if they hit /login directly.
  if (status === 'authenticated') {
    const from = (location.state as LocationState | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(loginValue, password);
      } else {
        await register(loginValue, password, race);
      }
    } catch (err) {
      setErrorMsg(messageFor(err, mode));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="sw-login-page">
      <form className="sw-login-card sw-panel" onSubmit={onSubmit}>
        <div className="sw-panel-head">
          <span className="title">{mode === 'login' ? 'Вход' : 'Регистрация'}</span>
          <span className="meta">STAR · WIND</span>
        </div>
        <div className="sw-panel-body">
          <div className="sw-form">
            <label>
              <span>Логин</span>
              <input
                type="text"
                autoComplete="username"
                value={loginValue}
                onChange={(e) => setLoginValue(e.target.value)}
                required
                autoFocus
              />
            </label>
            <label>
              <span>Пароль</span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            {mode === 'register' && (
              <label>
                <span>Раса</span>
                <select value={race} onChange={(e) => setRace(Number(e.target.value))}>
                  {PLAYABLE_RACES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {errorMsg && <span className="sw-login-card__error">{errorMsg}</span>}

            <button type="submit" className="sw-btn" disabled={submitting}>
              {submitting ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>

            <button
              type="button"
              className="sw-login-card__switch"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setErrorMsg(null);
              }}
            >
              {mode === 'login'
                ? 'Нет аккаунта? Зарегистрироваться'
                : 'Уже есть аккаунт? Войти'}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

function messageFor(err: unknown, mode: Mode): string {
  if (err instanceof AuthError) {
    switch (err.kind) {
      case 'invalid_credentials':
        return 'Неверный логин или пароль';
      case 'login_taken':
        return 'Такой логин уже занят';
      case 'validation':
        return err.message;
      case 'unauthenticated':
        return 'Сессия истекла, войдите снова';
      case 'network':
        return `Ошибка сети (${err.status})`;
    }
  }
  return mode === 'login' ? 'Не удалось войти' : 'Не удалось зарегистрироваться';
}
