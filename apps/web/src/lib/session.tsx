import type { Action, SessionInfo } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from './api';

interface SessionCtx {
  session: SessionInfo | null;
  loading: boolean;
  /** true while the server cannot be reached (we keep retrying) */
  offline: boolean;
  can: (module: string, action: Action) => boolean;
  refresh: () => Promise<void>;
  setSession: (s: SessionInfo | null) => void;
  switchCompany: (id: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api.get<SessionInfo>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    // Only 401 means "logged out". Server restarts / network blips keep retrying instead of
    // throwing the user back to the login screen.
    retry: true,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 10_000),
  });

  const setSession = useCallback((s: SessionInfo | null) => qc.setQueryData(['session'], s), [qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
  }, [setSession]);

  const value = useMemo<SessionCtx>(() => {
    const session = q.data ?? null;
    const perms = new Set(session?.permissions ?? []);
    return {
      session,
      loading: q.isLoading && q.failureCount === 0,
      offline: q.failureCount > 0 && q.data === undefined,
      can: (module, action) => !!session && (session.user.isSuperAdmin || perms.has(`${module}:${action}`)),
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: ['session'] });
      },
      setSession,
      switchCompany: async (id) => {
        const s = await api.post<SessionInfo>('/auth/switch-company', { companyId: id });
        // every cached list belongs to the old company
        qc.clear();
        qc.setQueryData(['session'], s);
      },
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        qc.clear();
        qc.setQueryData(['session'], null);
      },
    };
  }, [q.data, q.isLoading, q.failureCount, qc, setSession]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
