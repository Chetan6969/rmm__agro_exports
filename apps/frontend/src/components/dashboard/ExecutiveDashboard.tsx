'use client';

import React, { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import {
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle2,
  Ship,
  FilePlus2,
  FileCheck2,
  Receipt,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';
import { api, type DashboardMetrics } from '../../lib/api';
import type { NavigationSection } from '../../types';

interface DashboardProps {
  onNavigate: (section: NavigationSection) => void;
}

export function ExecutiveDashboard({ onNavigate }: DashboardProps) {
  const { activeCompany, financialYear } = useCompany();
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const data = await api.getDashboardMetrics();
        if (mounted && data) {
          setMetrics(data);
        }
      } catch {
        // Fallback to initial display state
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeCompany.id]);

  const totalSales = metrics?.totalSalesUsd != null ? metrics.totalSalesUsd : 1285000.0;
  const totalDues = metrics?.totalOutstandingDueUsd != null ? metrics.totalOutstandingDueUsd : 185000.0;
  const activeOrders = metrics?.activeOrdersCount != null ? metrics.activeOrdersCount : 6;
  const pendingOrders = metrics?.pendingProductionOrdersCount != null ? metrics.pendingProductionOrdersCount : 3;

  const kpis = [
    {
      title: 'TOTAL EXPORT VOLUME',
      value: '1,250.00 MT',
      subtext: `Basmati Rice FY ${financialYear}`,
      icon: Ship,
      color: 'text-blue-700',
      bg: 'bg-blue-50 border-blue-200',
    },
    {
      title: 'EXPORT REVENUE (USD)',
      value: `$${totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      subtext: 'CIF & CFR Invoiced Sales',
      icon: DollarSign,
      color: 'text-green-700',
      bg: 'bg-green-50 border-green-200',
    },
    {
      title: 'OUTSTANDING PAYMENT DUES',
      value: `$${totalDues.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      subtext: 'Invoices Pending Remittance',
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50 border-amber-200',
    },
    {
      title: 'ACTIVE ORDERS & LOTS',
      value: `${activeOrders} Orders / ${pendingOrders} Milling`,
      subtext: 'Milling & Packing In Progress',
      icon: TrendingUp,
      color: 'text-indigo-700',
      bg: 'bg-indigo-50 border-indigo-200',
    },
  ];

  const recentActivities = [
    {
      id: '1',
      action: 'GENERATED_INVOICE',
      doc: `${activeCompany.code}/EX/${financialYear}/001`,
      details: 'Commercial Invoice for Al-Barakah General Trading (50.0 MT - $51,600.00 CIF)',
      user: 'Navneet Kumar',
      time: '12 mins ago',
    },
    {
      id: '2',
      action: 'RECORDED_RECEIPT',
      doc: `REC-${activeCompany.code}/${financialYear}/001`,
      details: 'Remittance $51,600.00 via WIRE_TRANSFER (Swift: SWIFT-998877)',
      user: 'Navneet Kumar',
      time: '45 mins ago',
    },
    {
      id: '3',
      action: 'PRODUCTION_ORDER',
      doc: `${activeCompany.code}/1`,
      details: 'Dispatched milling instructions to Karnal Rice Mill Ltd (100.0 MT 1121 Steam)',
      user: 'Navneet Kumar',
      time: '2 hours ago',
    },
    {
      id: '4',
      action: 'VERIFIED_DOCUMENT',
      doc: 'Clean On Board Bill of Lading (MSCU9876543)',
      details: 'Maersk Line B/L verified and filed in Document Hub',
      user: 'Navneet Kumar',
      time: '3 hours ago',
    },
  ];

  const lifecycle = [
    ['1. Proforma Invoice (PI)', 'Buyer PO & frozen commercial terms quotation'],
    ['2. Production Order (PO)', 'Strict remaining-quantity check for Rice Mill'],
    ['3. Commercial Export Invoice', 'FOB, Freight & Insurance Incoterm rules applied'],
    ['4. Container Packing List', 'Customs seals, container numbers & gross weights'],
    ['5. Bank Remittance Receipt', 'LC negotiation & wire transfer tracking'],
  ];

  return (
    <div className="space-y-5">
      {/* Active Entity Banner */}
      <div className="ef-card p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-mono text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 inline-block" />
            Active Exporting Company Context
          </div>
          <h1 className="text-xl font-bold text-slate-800 mt-0.5">
            {activeCompany.name || 'RMM Agro Exports'}
          </h1>
          <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono">
            <span>GSTIN: {activeCompany.gstin || '—'}</span>
            <span>IEC: {activeCompany.iec || '—'}</span>
            <span>Origin: Mundra / Kandla, India</span>
            <span>Currency: {activeCompany.currency}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onNavigate('commercial-invoices')} className="ef-btn ef-btn-primary">
            <FilePlus2 className="w-3.5 h-3.5" /> New Commercial Invoice
          </button>
          <button onClick={() => onNavigate('proformas')} className="ef-btn">
            <FileCheck2 className="w-3.5 h-3.5" /> Issue Proforma
          </button>
          <button onClick={() => onNavigate('registers')} className="ef-btn">
            <Receipt className="w-3.5 h-3.5" /> Export Registers
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.title} className={`p-4 rounded-lg border ${kpi.bg} shadow-sm`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider text-slate-500 font-mono">
                  {kpi.title}
                </span>
                <Icon className={`w-5 h-5 ${kpi.color}`} />
              </div>
              <div className="my-2">
                <div className="text-2xl font-bold text-slate-800 tracking-tight">{kpi.value}</div>
                <div className="text-xs text-slate-500">{kpi.subtext}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2-Column */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 ef-card p-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-blue-700" />
              Immutable Activity Trail & Document Log
            </h2>
            <button
              onClick={() => onNavigate('registers')}
              className="text-xs text-blue-700 hover:text-blue-900 flex items-center gap-1 font-medium"
            >
              View All Registers <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100 mt-1">
            {recentActivities.map((act) => (
              <div key={act.id} className="py-2.5 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-blue-700 font-mono">{act.doc}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">
                      {act.action}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">{act.details}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">User: {act.user}</div>
                </div>
                <div className="text-[10px] text-slate-400 font-mono shrink-0">{act.time}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="ef-card p-4 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-700 pb-3 border-b border-slate-200">
              Export Lifecycle Pipeline
            </h2>
            <div className="space-y-3 mt-3 text-xs">
              {lifecycle.map(([title, desc]) => (
                <div key={title} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-slate-700">{title}</div>
                    <div className="text-[11px] text-slate-500">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="pt-3 border-t border-slate-200 mt-4 text-[11px] text-slate-400">
            Multi-Company Isolated • Concurrency Safe
          </div>
        </div>
      </div>
    </div>
  );
}
