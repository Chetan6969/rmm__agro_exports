'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type CompanyBrief } from '../lib/api';
import type { Company } from '../types';

function computeFinancialYear(d = new Date()): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

function briefToCompany(c: CompanyBrief): Company {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    gstin: '',
    iec: '',
    address: '',
    currency: 'USD',
  };
}

type Status = 'loading' | 'authed' | 'anon';

interface CompanyContextType {
  status: Status;
  companies: Company[];
  activeCompany: Company;
  financialYear: string;
  switchCompany: (companyId: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  currentUser: { username: string; role: string };
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

const EMPTY_COMPANY: Company = {
  id: '',
  name: '',
  code: '',
  gstin: '',
  iec: '',
  address: '',
  currency: 'USD',
};

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [activeCompany, setActiveCompany] = useState<Company>(EMPTY_COMPANY);
  const [currentUser, setCurrentUser] = useState({
    username: '',
    role: '',
  });
  const [financialYear, setFinancialYear] = useState('');

  useEffect(() => {
    setFinancialYear(computeFinancialYear());
  }, []);

  const hydrateCompany = useCallback(async (id: string) => {
    try {
      const detail = await api.company(id);
      setActiveCompany({
        id: detail.id,
        name: detail.name,
        code: detail.code,
        gstin: detail.gstin || '',
        iec: detail.iecCode || '',
        address: [detail.addressLine1, detail.city, detail.state]
          .filter(Boolean)
          .join(', '),
        currency: 'USD',
      });
    } catch {
      /* keep brief company */
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const me = await api.me();
      setCurrentUser({ username: me.user.fullName || me.user.username, role: me.user.role });
      setActiveCompany({ ...EMPTY_COMPANY, id: me.activeCompanyId, code: me.activeCompanyCode });
      await hydrateCompany(me.activeCompanyId);
      setStatus('authed');
    } catch {
      setStatus('anon');
    }
  }, [hydrateCompany]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.login(username, password);
      setCurrentUser({ username: res.user.fullName || res.user.username, role: res.user.role });
      setCompanies(res.companies.map(briefToCompany));
      setActiveCompany(briefToCompany(res.activeCompany));
      await hydrateCompany(res.activeCompany.id);
      setStatus('authed');
    },
    [hydrateCompany],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setStatus('anon');
    setCurrentUser({ username: '', role: '' });
    setActiveCompany(EMPTY_COMPANY);
    setCompanies([]);
  }, []);

  const switchCompany = useCallback(
    (companyId: string) => {
      const found = companies.find((c) => c.id === companyId);
      if (found) {
        setActiveCompany(found);
        void hydrateCompany(companyId);
      }
    },
    [companies, hydrateCompany],
  );

  return (
    <CompanyContext.Provider
      value={{
        status,
        companies: companies.length ? companies : [activeCompany],
        activeCompany,
        financialYear,
        switchCompany,
        login,
        logout,
        currentUser,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}
