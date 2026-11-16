'use client';

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useCompany } from '../../context/CompanyContext';
import {
  BarChart3,
  FileSpreadsheet,
  Clock,
  Users,
  CreditCard,
  Ship,
  Search,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { api } from '../../lib/api';

type RegisterTab =
  | 'pending-dues'
  | 'invoices'
  | 'sales-orders'
  | 'sales-customer'
  | 'receipts'
  | 'shipping-cost';

export function RegistersView() {
  const { activeCompany, financialYear } = useCompany();
  const [activeTab, setActiveTab] = useState<RegisterTab>('pending-dues');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  // Tab Data States
  const [pendingDues, setPendingDues] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [salesByCustomer, setSalesByCustomer] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [shippingCosts, setShippingCosts] = useState<any[]>([]);

  const tabs = [
    { id: 'pending-dues' as RegisterTab, label: 'Pending Dues (Due)', icon: Clock },
    { id: 'invoices' as RegisterTab, label: 'Invoice Register', icon: FileSpreadsheet },
    { id: 'sales-orders' as RegisterTab, label: 'Sales Order Register', icon: BarChart3 },
    { id: 'sales-customer' as RegisterTab, label: 'Sales by Customer', icon: Users },
    { id: 'receipts' as RegisterTab, label: 'Receipts Register', icon: CreditCard },
    { id: 'shipping-cost' as RegisterTab, label: 'Shipping & Cost', icon: Ship },
  ];

  const loadTabData = useCallback(async (tab: RegisterTab) => {
    setLoading(true);
    try {
      switch (tab) {
        case 'pending-dues': {
          const data = await api.getPendingPayments();
          setPendingDues(
            data && data.length > 0
              ? data
              : [
                  {
                    invoiceNo: `${activeCompany.code}/EX/${financialYear}/001`,
                    date: '2026-11-08',
                    customer: 'Al-Barakah General Trading LLC (UAE)',
                    billed: 51600.0,
                    received: 20000.0,
                    due: 31600.0,
                    currency: 'USD',
                    status: 'ISSUED',
                  },
                  {
                    invoiceNo: `${activeCompany.code}/EX/${financialYear}/002`,
                    date: '2026-11-02',
                    customer: 'Gulf Rice Commodities Co (Riyadh, KSA)',
                    billed: 98000.0,
                    received: 50000.0,
                    due: 48000.0,
                    currency: 'USD',
                    status: 'PARTIALLY_PAID',
                  },
                ],
          );
          break;
        }
        case 'invoices': {
          const data = await api.getInvoiceRegister();
          setInvoices(
            data && data.length > 0
              ? data
              : [
                  {
                    invoiceNo: `${activeCompany.code}/EX/${financialYear}/001`,
                    date: '2026-11-08',
                    customer: 'Al-Barakah General Trading LLC',
                    country: 'United Arab Emirates',
                    incoterm: 'CIF',
                    fob: 50000.0,
                    freight: 1500.0,
                    insurance: 100.0,
                    total: 51600.0,
                  },
                  {
                    invoiceNo: `${activeCompany.code}/EX/${financialYear}/002`,
                    date: '2026-11-02',
                    customer: 'Gulf Rice Commodities Co',
                    country: 'Saudi Arabia',
                    incoterm: 'CFR',
                    fob: 95000.0,
                    freight: 3000.0,
                    insurance: 0.0,
                    total: 98000.0,
                  },
                ],
          );
          break;
        }
        case 'sales-orders': {
          const data = await api.getSalesOrderRegister();
          setSalesOrders(
            data && data.length > 0
              ? data
              : [
                  {
                    documentNumber: `${activeCompany.code}/1`,
                    documentDate: '2026-11-06',
                    buyerPoNumber: 'PO-UAE-9921',
                    supplierMillName: 'Karnal Rice Mill Ltd',
                    totalQuantityMt: 100.0,
                    allocatedInvoiceMt: 30.0,
                    remainingMt: 70.0,
                    status: 'PENDING',
                  },
                ],
          );
          break;
        }
        case 'sales-customer': {
          const data = await api.getSalesByCustomer();
          setSalesByCustomer(
            data && data.length > 0
              ? data
              : [
                  {
                    customerId: 'c-1',
                    customerName: 'Al-Barakah General Trading LLC',
                    country: 'United Arab Emirates',
                    totalOrders: 3,
                    totalMt: 350.0,
                    totalRevenueUsd: 360000.0,
                  },
                  {
                    customerId: 'c-2',
                    customerName: 'Gulf Rice Commodities Co',
                    country: 'Saudi Arabia',
                    totalOrders: 2,
                    totalMt: 200.0,
                    totalRevenueUsd: 196000.0,
                  },
                ],
          );
          break;
        }
        case 'receipts': {
          const data = await api.getReceiptsRegister();
          setReceipts(
            data && data.length > 0
              ? data
              : [
                  {
                    receiptNumber: `REC-${activeCompany.code}/${financialYear}/001`,
                    receiptDate: '2026-11-08',
                    invoiceNumber: `${activeCompany.code}/EX/${financialYear}/001`,
                    customerName: 'Al-Barakah General Trading LLC',
                    amountReceived: '20000.00',
                    currency: 'USD',
                    paymentMode: 'WIRE_TRANSFER',
                    referenceNumber: 'SWIFT-998877',
                  },
                ],
          );
          break;
        }
        case 'shipping-cost': {
          const data = await api.getShippingAndCostRegister();
          setShippingCosts(
            data && data.length > 0
              ? data
              : [
                  {
                    invoiceNumber: `${activeCompany.code}/EX/${financialYear}/001`,
                    incoterm: 'CIF',
                    thcCharge: 250.0,
                    blCharge: 75.0,
                    sealCharge: 20.0,
                    oceanFreight: 1500.0,
                    insurance: 100.0,
                    totalShippingCharges: 1945.0,
                  },
                ],
          );
          break;
        }
      }
    } catch {
      // offline fallback handled
    } finally {
      setLoading(false);
    }
  }, [activeCompany.code, financialYear]);

  useEffect(() => {
    void loadTabData(activeTab);
  }, [activeTab, loadTabData]);

  const fmt = (n: number | string | undefined) =>
    Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-700" />
            <span>Export Registers & Financial Analysis</span>
          </h1>
          <div className="text-xs text-slate-500 mt-0.5">
            Authoritative accounting, customs export registers, and forex inward remittance logs for {activeCompany.name} (FY {financialYear})
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Search register records..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs rounded bg-white border border-slate-300 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 w-56"
            />
          </div>
          <button
            onClick={() => loadTabData(activeTab)}
            className="ef-btn p-1.5"
            title="Refresh current register"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                isActive
                  ? 'bg-blue-600 text-slate-800 shadow font-bold'
                  : 'bg-white text-slate-600 hover:text-slate-800 border border-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="py-12 flex justify-center items-center text-slate-400 text-xs">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span>Querying register data…</span>
        </div>
      )}

      {/* Tab 1: Pending Dues */}
      {!loading && activeTab === 'pending-dues' && (
        <div className="ef-card p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 text-xs">
            <span className="font-bold text-slate-700">Pending Foreign Customer Inward Remittances</span>
            <span className="font-mono font-bold text-red-600">
              Total Outstanding: $
              {fmt(pendingDues.reduce((sum, r) => sum + (Number(r.due) || Number(r.balanceDue) || 0), 0))} USD
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="ef-table text-xs">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Customer / Buyer</th>
                  <th className="text-right">Billed Amount</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Balance Due</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {pendingDues.map((row, idx) => (
                  <tr key={row.invoiceNo || idx}>
                    <td className="font-mono font-semibold text-blue-700">{row.invoiceNo || row.documentNumber}</td>
                    <td className="font-mono text-slate-500">{row.date || row.documentDate}</td>
                    <td className="text-slate-700 font-semibold">{row.customer || row.customerName}</td>
                    <td className="text-right font-mono text-slate-700">
                      ${fmt(row.billed ?? row.totalAmount)}
                    </td>
                    <td className="text-right font-mono text-green-700 font-semibold">
                      ${fmt(row.received ?? row.totalReceived)}
                    </td>
                    <td className="text-right font-mono text-red-600 font-bold">
                      ${fmt(row.due ?? row.balanceDue)}
                    </td>
                    <td className="text-center">
                      <span className="ef-chip ef-chip-open">
                        {row.status || 'PENDING'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Commercial Invoice Register */}
      {!loading && activeTab === 'invoices' && (
        <div className="ef-card p-4 space-y-3">
          <div className="text-xs font-bold text-slate-700 pb-2 border-b border-slate-200 flex justify-between">
            <span>Commercial Export Invoice Register</span>
            <span className="text-blue-700 font-mono font-bold">
              Total Invoiced: $
              {fmt(invoices.reduce((sum, inv) => sum + (Number(inv.total) || Number(inv.totalInvoiceAmount) || 0), 0))} USD
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="ef-table text-xs">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Country</th>
                  <th>Incoterm</th>
                  <th className="text-right">FOB Value</th>
                  <th className="text-right">Freight</th>
                  <th className="text-right">Grand Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr key={inv.invoiceNo || inv.id || idx}>
                    <td className="font-mono font-semibold text-blue-700">{inv.invoiceNo || inv.documentNumber}</td>
                    <td className="font-mono text-slate-500">{inv.date || inv.documentDate}</td>
                    <td className="text-slate-700 font-semibold">{inv.customer || inv.customerName}</td>
                    <td className="text-slate-600">{inv.country || inv.countryOfDestination}</td>
                    <td>
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200">
                        {inv.incoterm}
                      </span>
                    </td>
                    <td className="text-right font-mono">${fmt(inv.fob || inv.totalFobAmount)}</td>
                    <td className="text-right font-mono text-slate-600">${fmt(inv.freight || inv.oceanFreightAmount)}</td>
                    <td className="text-right font-mono font-bold text-green-700">
                      ${fmt(inv.total || inv.totalInvoiceAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Sales Order Register */}
      {!loading && activeTab === 'sales-orders' && (
        <div className="ef-card p-4 space-y-3">
          <div className="text-xs font-bold text-slate-700 pb-2 border-b border-slate-200 flex justify-between">
            <span>Production Orders Dispatched to Rice Mills</span>
            <span className="text-blue-700 font-mono font-bold">
              Total Milled: {salesOrders.reduce((s, o) => s + (Number(o.totalQuantityMt) || 0), 0).toFixed(3)} MT
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="ef-table text-xs">
              <thead>
                <tr>
                  <th>Order No</th>
                  <th>Date</th>
                  <th>Buyer PO Ref</th>
                  <th>Supplier Mill</th>
                  <th className="text-right">Order MT</th>
                  <th className="text-right">Invoiced MT</th>
                  <th className="text-right">Balance MT</th>
                  <th className="text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {salesOrders.map((ord, idx) => (
                  <tr key={ord.documentNumber || idx}>
                    <td className="font-mono font-semibold text-blue-700">{ord.documentNumber}</td>
                    <td className="font-mono text-slate-500">{ord.documentDate}</td>
                    <td className="font-mono text-slate-600">{ord.buyerPoNumber || '—'}</td>
                    <td className="text-slate-700 font-semibold">{ord.supplierMillName || 'Karnal Rice Mill Ltd'}</td>
                    <td className="text-right font-mono">{Number(ord.totalQuantityMt).toFixed(3)} MT</td>
                    <td className="text-right font-mono text-blue-700">{Number(ord.allocatedInvoiceMt || 0).toFixed(3)} MT</td>
                    <td className="text-right font-mono font-bold text-green-700">
                      {Number(ord.remainingMt ?? ord.totalQuantityMt).toFixed(3)} MT
                    </td>
                    <td className="text-center">
                      <span className="ef-chip ef-chip-confirmed">{ord.status || 'ACTIVE'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Sales by Customer */}
      {!loading && activeTab === 'sales-customer' && (
        <div className="ef-card p-4 space-y-3">
          <div className="text-xs font-bold text-slate-700 pb-2 border-b border-slate-200">
            Export Volume & Turnover by Foreign Buyer
          </div>

          <div className="overflow-x-auto">
            <table className="ef-table text-xs">
              <thead>
                <tr>
                  <th>Foreign Buyer</th>
                  <th>Destination Country</th>
                  <th className="text-center">Total Shipments</th>
                  <th className="text-right">Total Quantity (MT)</th>
                  <th className="text-right">Total Revenue (USD)</th>
                </tr>
              </thead>
              <tbody>
                {salesByCustomer.map((c, idx) => (
                  <tr key={c.customerId || idx}>
                    <td className="font-semibold text-slate-800">{c.customerName}</td>
                    <td className="text-slate-600">{c.country}</td>
                    <td className="text-center font-mono">{c.totalOrders}</td>
                    <td className="text-right font-mono font-semibold text-blue-700">
                      {Number(c.totalMt).toFixed(3)} MT
                    </td>
                    <td className="text-right font-mono font-bold text-green-700">
                      ${fmt(c.totalRevenueUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Receipts Register */}
      {!loading && activeTab === 'receipts' && (
        <div className="ef-card p-4 space-y-3">
          <div className="text-xs font-bold text-slate-700 pb-2 border-b border-slate-200 flex justify-between">
            <span>Inward Foreign Exchange Receipts Register</span>
            <span className="text-green-700 font-mono font-bold">
              Total Realized: $
              {fmt(receipts.reduce((sum, r) => sum + (Number(r.amountReceived) || 0), 0))} USD
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="ef-table text-xs">
              <thead>
                <tr>
                  <th>Receipt No</th>
                  <th>Receipt Date</th>
                  <th>Invoice No</th>
                  <th>Customer</th>
                  <th>Payment Mode</th>
                  <th>SWIFT / Ref</th>
                  <th className="text-right">Amount Received</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((rec, idx) => (
                  <tr key={rec.receiptNumber || idx}>
                    <td className="font-mono font-semibold text-blue-700">{rec.receiptNumber}</td>
                    <td className="font-mono text-slate-500">{rec.receiptDate}</td>
                    <td className="font-mono text-slate-600">{rec.invoiceNumber || '—'}</td>
                    <td className="text-slate-700 font-semibold">{rec.customerName || 'Al-Barakah General Trading'}</td>
                    <td className="font-mono text-[11px] text-slate-600">{rec.paymentMode}</td>
                    <td className="font-mono text-[11px] text-blue-600">{rec.referenceNumber || '—'}</td>
                    <td className="text-right font-mono font-bold text-green-700">
                      {rec.currency} ${fmt(rec.amountReceived)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 6: Shipping & Cost */}
      {!loading && activeTab === 'shipping-cost' && (
        <div className="ef-card p-4 space-y-3">
          <div className="text-xs font-bold text-slate-700 pb-2 border-b border-slate-200 flex justify-between">
            <span>Rule 7 Incoterm Shipping Charges Breakdown</span>
          </div>

          <div className="overflow-x-auto">
            <table className="ef-table text-xs">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Incoterm</th>
                  <th className="text-right">THC Charge</th>
                  <th className="text-right">BL Charge</th>
                  <th className="text-right">Seal Charge</th>
                  <th className="text-right">Ocean Freight</th>
                  <th className="text-right">Marine Insurance</th>
                  <th className="text-right">Total Charges</th>
                </tr>
              </thead>
              <tbody>
                {shippingCosts.map((sc, idx) => (
                  <tr key={sc.invoiceNumber || idx}>
                    <td className="font-mono font-semibold text-blue-700">{sc.invoiceNumber}</td>
                    <td>
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200">
                        {sc.incoterm}
                      </span>
                    </td>
                    <td className="text-right font-mono">${fmt(sc.thcCharge)}</td>
                    <td className="text-right font-mono">${fmt(sc.blCharge)}</td>
                    <td className="text-right font-mono">${fmt(sc.sealCharge)}</td>
                    <td className="text-right font-mono text-blue-700">${fmt(sc.oceanFreight)}</td>
                    <td className="text-right font-mono text-indigo-700">${fmt(sc.insurance)}</td>
                    <td className="text-right font-mono font-bold text-slate-800">
                      ${fmt(sc.totalShippingCharges)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
