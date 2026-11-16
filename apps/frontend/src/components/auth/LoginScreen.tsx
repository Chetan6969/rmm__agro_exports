'use client';

import React, { useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Wheat, LogIn, Loader2 } from 'lucide-react';

export function LoginScreen() {
  const { login } = useCompany();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        background:
          'linear-gradient(135deg, #e7edf6 0%, #dbe6f5 50%, #e9eef6 100%)',
      }}
    >
      <div className="ef-card w-full max-w-sm overflow-hidden">
        <div className="ef-modal-bar">
          <span className="flex items-center gap-2">
            <Wheat className="w-4 h-4" /> ExportFly — RMM Agro Exports
          </span>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <div className="text-lg font-bold text-slate-800">Sign in</div>
            <div className="text-xs text-slate-500">
              Enterprise Export Management System
            </div>
          </div>

          <div>
            <label className="ef-label">Username</label>
            <input
              className="ef-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="ef-label">Password</label>
            <input
              className="ef-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="ef-btn ef-btn-primary w-full justify-center py-2"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>

          <div className="text-[11px] text-slate-400 text-center">
            Dev credentials pre-filled: admin / Admin@123
          </div>
        </form>
      </div>
    </div>
  );
}
