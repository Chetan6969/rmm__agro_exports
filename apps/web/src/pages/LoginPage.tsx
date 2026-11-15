import type { SessionInfo } from '@rmm/shared';
import { Wheat } from 'lucide-react';
import { useState } from 'react';
import { Button, ErrorBox } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';

export function LoginPage() {
  const { setSession } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await api.post<SessionInfo>('/auth/login', { username, password }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <Wheat className="size-6 text-brand-700" />
          <div>
            <h1 className="text-[17px] font-semibold text-slate-900">Export ERP</h1>
            <p className="text-[12.5px] text-slate-500">Sign in to continue</p>
          </div>
        </div>
        <ErrorBox error={error} />
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Username</span>
          <input autoFocus autoComplete="username" className="field-input" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-medium text-slate-600">Password</span>
          <input type="password" autoComplete="current-password" className="field-input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" loading={busy} className="w-full justify-center" disabled={!username || !password}>
          Sign in
        </Button>
      </form>
    </div>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { refresh, logout } = useSession();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== again) return setError(new Error('The two new passwords do not match. Type the same new password in both boxes.'));
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-xl">
        <div>
          <h1 className="text-[17px] font-semibold text-slate-900">Set a new password</h1>
          {forced && <p className="text-[12.5px] text-slate-500">Your password was set by an administrator. Choose your own to continue.</p>}
        </div>
        <ErrorBox error={error} />
        {[
          ['Current password', cur, setCur, 'current-password'],
          ['New password (8+ chars, a letter and a number)', next, setNext, 'new-password'],
          ['Repeat new password', again, setAgain, 'new-password'],
        ].map(([label, v, set, ac], i) => (
          <label key={label as string} className="block">
            <span className="mb-1 block text-[12.5px] font-medium text-slate-600">{label as string}</span>
            <input
              autoFocus={i === 0}
              type="password"
              autoComplete={ac as string}
              className="field-input"
              value={v as string}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            />
          </label>
        ))}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy} className="flex-1 justify-center">
            Save password
          </Button>
          <Button onClick={() => logout()}>Log out</Button>
        </div>
      </form>
    </div>
  );
}
