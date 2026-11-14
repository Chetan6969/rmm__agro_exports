'use client';

import React, { useState } from 'react';
import { CompanyProvider, useCompany } from '../context/CompanyContext';
import { Header } from '../components/layout/Header';
import { Sidebar } from '../components/layout/Sidebar';
import { ExecutiveDashboard } from '../components/dashboard/ExecutiveDashboard';
import { ProformaInvoices } from '../components/proforma/ProformaInvoices';
import { ProductionOrders } from '../components/production/ProductionOrders';
import { Invoices } from '../components/invoice/Invoices';
import { RegistersView } from '../components/reports/RegistersView';
import { DocumentHubChecklist } from '../components/documents/DocumentHubChecklist';
import { LoginScreen } from '../components/auth/LoginScreen';
import { Loader2 } from 'lucide-react';
import type { NavigationSection } from '../types';

function Workstation() {
  const { status } = useCompany();
  const [currentSection, setCurrentSection] =
    useState<NavigationSection>('dashboard');

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (status === 'anon') {
    return <LoginScreen />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          currentSection={currentSection}
          onSelectSection={setCurrentSection}
        />
        <main className="flex-1 p-5 overflow-y-auto bg-[#eceff4]">
          {currentSection === 'dashboard' && (
            <ExecutiveDashboard onNavigate={setCurrentSection} />
          )}

          {currentSection === 'proformas' && <ProformaInvoices />}

          {currentSection === 'production-orders' && <ProductionOrders />}

          {currentSection === 'commercial-invoices' && <Invoices />}

          {currentSection === 'registers' && <RegistersView />}

          {(currentSection === 'document-hub' ||
            currentSection === 'packing-lists') && <DocumentHubChecklist />}

          {currentSection !== 'dashboard' &&
            currentSection !== 'proformas' &&
            currentSection !== 'production-orders' &&
            currentSection !== 'commercial-invoices' &&
            currentSection !== 'registers' &&
            currentSection !== 'document-hub' &&
            currentSection !== 'packing-lists' && (
              <div className="ef-card p-8 text-center space-y-2">
                <h2 className="text-base font-bold text-slate-800 capitalize">
                  {currentSection.replace('-', ' ')}
                </h2>
                <p className="text-xs text-slate-500">
                  This master-data panel is scoped to the active company. Build
                  it out next — the Proforma Invoices module is the reference
                  implementation.
                </p>
              </div>
            )}
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <CompanyProvider>
      <Workstation />
    </CompanyProvider>
  );
}
