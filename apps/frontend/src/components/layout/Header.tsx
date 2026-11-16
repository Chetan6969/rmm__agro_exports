'use client';

import React from 'react';
import { useCompany } from '../../context/CompanyContext';
import { Building2, ChevronDown, ShieldCheck, LogOut, Wheat } from 'lucide-react';

export function Header() {
  const { companies, activeCompany, financialYear, switchCompany, currentUser, logout } =
    useCompany();

  const initials = (currentUser.username || 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="h-14 border-b border-[#c9d2de] bg-white text-slate-800 flex items-center justify-between px-4 sticky top-0 z-50 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded bg-blue-700 flex items-center justify-center font-bold text-white shadow-sm">
            <Wheat className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-sm tracking-wide flex items-center gap-1.5 text-slate-800">
              <span>ExportFly</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono border border-blue-200">
                RMM AGRO
              </span>
            </div>
            <div className="text-[10px] text-slate-500">
              Enterprise Export Management
            </div>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-200 mx-1" />

        <div className="relative flex items-center">
          <Building2 className="w-4 h-4 text-blue-700 absolute left-2.5 pointer-events-none" />
          <select
            aria-label="Active Exporting Entity"
            value={activeCompany.id}
            onChange={(e) => switchCompany(e.target.value)}
            className="pl-8 pr-7 py-1.5 text-xs font-semibold rounded bg-white border border-[#aab6c6] text-slate-700 hover:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer appearance-none"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.code ? `(${c.code})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2 text-xs">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600 font-mono text-[11px]">
          <span className="text-slate-400">FY:</span>
          <span className="text-blue-700 font-bold">{financialYear}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 text-[11px]">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          <span>Online</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-xs font-semibold text-slate-700">
            {currentUser.username}
          </div>
          <div className="text-[10px] text-blue-700 font-mono flex items-center justify-end gap-1">
            <ShieldCheck className="w-3 h-3" />
            <span>{currentUser.role}</span>
          </div>
        </div>
        <div className="w-8 h-8 rounded-full bg-blue-700 text-white font-bold text-xs flex items-center justify-center shadow-sm">
          {initials}
        </div>
        <button
          onClick={() => void logout()}
          title="Sign out"
          className="ef-btn px-2 py-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
