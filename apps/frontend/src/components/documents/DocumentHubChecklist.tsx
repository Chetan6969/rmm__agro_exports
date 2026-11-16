'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import {
  FolderCheck,
  CheckCircle,
  Clock,
  ShieldCheck,
  Building,
  Layers,
  Printer,
  Plus,
  RefreshCw,
  Loader2,
  X,
} from 'lucide-react';
import {
  api,
  type MasterOrderItem,
  type DocumentHubChecklistItem,
  type Customer,
} from '../../lib/api';

interface ChecklistDisplayItem {
  id: string;
  type: string;
  title: string;
  classification: 'GENERATED' | 'COLLECTED';
  isVerified: boolean;
  status: 'PENDING' | 'DRAFTED' | 'COLLECTED' | 'VERIFIED';
  notes: string;
}

const DEFAULT_STANDARD_CHECKLIST: ChecklistDisplayItem[] = [
  {
    id: 'doc-1',
    type: 'COMMERCIAL_INVOICE',
    title: 'Commercial Export Invoice (Quadruplicate)',
    classification: 'GENERATED',
    isVerified: true,
    status: 'VERIFIED',
    notes: 'Signed and stamped with official company seal',
  },
  {
    id: 'doc-2',
    type: 'PACKING_LIST',
    title: 'Customs Packing List',
    classification: 'GENERATED',
    isVerified: true,
    status: 'VERIFIED',
    notes: 'Detailed container & seal numbers with gross/net weights',
  },
  {
    id: 'doc-3',
    type: 'CERT_ORIGIN',
    title: 'Certificate of Origin (Non-Preferential)',
    classification: 'GENERATED',
    isVerified: true,
    status: 'VERIFIED',
    notes: 'Issued by Chamber of Commerce & Industry',
  },
  {
    id: 'doc-4',
    type: 'BILL_OF_EXCHANGE',
    title: 'Bill of Exchange / Financial Draft',
    classification: 'GENERATED',
    isVerified: true,
    status: 'VERIFIED',
    notes: 'Drawn under LC at sight on Emirates NBD Bank',
  },
  {
    id: 'doc-5',
    type: 'BENEFICIARY_CERT',
    title: 'Beneficiary Certificate',
    classification: 'GENERATED',
    isVerified: true,
    status: 'VERIFIED',
    notes: 'Certifying non-negotiable copy dispatched via DHL',
  },
  {
    id: 'doc-6',
    type: 'BILL_OF_LADING',
    title: 'Clean On Board Marine Ocean Bill of Lading',
    classification: 'COLLECTED',
    isVerified: true,
    status: 'VERIFIED',
    notes: '3/3 original bills of lading issued by Maersk Line',
  },
  {
    id: 'doc-7',
    type: 'INSURANCE_CERT',
    title: 'Marine Cargo Insurance Policy',
    classification: 'COLLECTED',
    isVerified: true,
    status: 'VERIFIED',
    notes: 'Institute Cargo Clauses (A) 110% of CIF value',
  },
  {
    id: 'doc-8',
    type: 'PHYTOSANITARY_CERT',
    title: 'Plant Quarantine Phytosanitary Certificate',
    classification: 'COLLECTED',
    isVerified: false,
    status: 'PENDING',
    notes: 'Awaiting port quarantine clearance at Mundra',
  },
  {
    id: 'doc-9',
    type: 'INSPECTION_CERT',
    title: 'SGS Pre-Shipment Weight & Quality Survey',
    classification: 'COLLECTED',
    isVerified: false,
    status: 'PENDING',
    notes: 'Surveyor final report pending moisture test result',
  },
];

export function DocumentHubChecklist() {
  const { activeCompany, financialYear } = useCompany();

  const [orders, setOrders] = useState<MasterOrderItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [items, setItems] = useState<ChecklistDisplayItem[]>(DEFAULT_STANDARD_CHECKLIST);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);

  // New Order Form state
  const [newOrderDate, setNewOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newBuyerPo, setNewBuyerPo] = useState('PO-UAE-9921');
  const [newCustomerId, setNewCustomerId] = useState('');
  const [newTotalMt, setNewTotalMt] = useState(500);
  const [newIncoterm, setNewIncoterm] = useState('CIF');
  const [newLcNumber, setNewLcNumber] = useState('LC-EMIRATES-889900');
  const [orderCreating, setOrderCreating] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const [orderList, custList] = await Promise.all([api.listOrders(), api.customers()]);
      setOrders(orderList);
      setCustomers(custList);
      if (custList.length > 0 && !newCustomerId) {
        setNewCustomerId(custList[0].id);
      }
      if (orderList.length > 0 && !selectedOrderId) {
        setSelectedOrderId(orderList[0].id);
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, [newCustomerId, selectedOrderId]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const loadOrderChecklist = useCallback(async (orderId: string) => {
    try {
      const details = await api.getOrderDetails(orderId);
      if (details?.checklist && details.checklist.length > 0) {
        const mapped: ChecklistDisplayItem[] = details.checklist.map((c: DocumentHubChecklistItem) => ({
          id: c.id,
          type: c.documentType,
          title: c.documentType.replace(/_/g, ' '),
          classification: c.classification,
          isVerified: c.status === 'VERIFIED',
          status: c.status,
          notes: c.notes || '',
        }));
        setItems(mapped);
      }
    } catch {
      // Retain fallback items
    }
  }, []);

  useEffect(() => {
    if (selectedOrderId) {
      void loadOrderChecklist(selectedOrderId);
    }
  }, [selectedOrderId, loadOrderChecklist]);

  const verifiedCount = items.filter((i) => i.isVerified).length;
  const progressPercent = items.length > 0 ? Math.round((verifiedCount / items.length) * 100) : 0;

  const toggleVerify = async (id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const nextStatus = it.isVerified ? 'PENDING' : 'VERIFIED';

    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, isVerified: !i.isVerified, status: nextStatus } : i)),
    );

    // Call API if this item has a UUID (database record)
    if (id.includes('-') && id.length > 10 && !id.startsWith('doc-')) {
      setUpdatingId(id);
      try {
        await api.updateDocumentStatus(id, { status: nextStatus });
      } catch {
        // revert on error
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, isVerified: it.isVerified, status: it.status } : i)),
        );
      } finally {
        setUpdatingId(null);
      }
    }
  };

  const handleCreateMasterOrder = async () => {
    setOrderCreating(true);
    try {
      const res = await api.createMasterOrder({
        orderDate: newOrderDate,
        buyerPoNumber: newBuyerPo,
        customerId: newCustomerId || customers[0]?.id || '00000000-0000-0000-0000-000000000001',
        totalQuantityMt: newTotalMt,
        incoterm: newIncoterm,
        destinationCountry: 'United Arab Emirates',
        portOfLoading: 'Mundra Port',
        portOfDischarge: 'Jebel Ali Port',
        lcNumber: newLcNumber,
      });

      setShowNewOrderModal(false);
      await loadOrders();
      if (res?.id) {
        setSelectedOrderId(res.id);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create order');
    } finally {
      setOrderCreating(false);
    }
  };

  const activeOrder = orders.find((o) => o.id === selectedOrderId);

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <FolderCheck className="w-5 h-5 text-blue-700" />
              <span>Export Document Hub & Checklist</span>
            </h1>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200">
              {activeOrder?.documentNumber || `ORD-${activeCompany.code}/${financialYear}/001`}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            End-to-end export documentation docket, container packing lists, and bank negotiation readiness
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewOrderModal(true)}
            className="ef-btn ef-btn-primary flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Master Order</span>
          </button>
          <a
            href={api.samplePackingListPdfUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="ef-btn flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5 text-blue-600" />
            <span>A4 Packing List PDF</span>
          </a>
          <button onClick={loadOrders} className="ef-btn p-1.5" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Order & LC Header Card */}
      <div className="p-4 rounded-lg bg-white border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-200 gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">
                {activeOrder ? activeOrder.documentNumber : `ORD-${activeCompany.code}/${financialYear}/001`}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold">
                {activeOrder?.incoterm || 'CIF'}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {activeOrder ? `${activeOrder.totalQuantityMt} MT` : '500.00 MT'} Basmati Rice • Split into Shipment Lots
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs font-mono font-bold text-green-700 flex items-center gap-1">
              <Building className="w-3.5 h-3.5" />
              <span>LC: {newLcNumber}</span>
            </div>
            <div className="text-[11px] text-slate-500">
              Issuing Bank: Emirates NBD PJSC, Dubai
            </div>
          </div>
        </div>

        {/* Readiness Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600 font-semibold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-green-600" />
              <span>Export Negotiation Readiness</span>
            </span>
            <span className="font-mono font-bold text-blue-700">
              {verifiedCount} of {items.length} Documents Verified ({progressPercent}%)
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ${
                progressPercent === 100 ? 'bg-emerald-500' : 'bg-blue-600'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Shipment Lots Quick Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200 flex items-center justify-between text-xs font-mono">
            <div>
              <div className="font-bold text-slate-700">Lot #1 (200.0 MT)</div>
              <div className="text-[10px] text-slate-500">
                Invoice: {activeCompany.code}/EX/{financialYear}/001
              </div>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-semibold">
              INVOICED
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200 flex items-center justify-between text-xs font-mono">
            <div>
              <div className="font-bold text-slate-700">Lot #2 (150.0 MT)</div>
              <div className="text-[10px] text-slate-500">Dispatching to Mundra</div>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">
              DISPATCHED
            </span>
          </div>
          <div className="p-2.5 rounded bg-slate-50 border border-slate-200 flex items-center justify-between text-xs font-mono">
            <div>
              <div className="font-bold text-slate-700">Lot #3 (150.0 MT)</div>
              <div className="text-[10px] text-slate-500">Milling at Karnal Mill</div>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">
              PLANNED
            </span>
          </div>
        </div>
      </div>

      {/* 9-Point Document Checklist Table */}
      <div className="rounded-lg bg-white border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-700" />
            <span>9-Point Export Document Checklist for Bank Negotiation</span>
          </h2>
          <span className="text-xs text-slate-500">
            Click checkbox to toggle verification audit
          </span>
        </div>

        <div className="divide-y divide-slate-200">
          {items.map((doc) => (
            <div
              key={doc.id}
              onClick={() => toggleVerify(doc.id)}
              className="py-3 flex items-start justify-between gap-4 cursor-pointer hover:bg-slate-50 px-2 rounded transition-colors"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={doc.isVerified}
                  onChange={() => toggleVerify(doc.id)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 accent-blue-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold ${
                        doc.isVerified ? 'text-slate-800' : 'text-slate-600'
                      }`}
                    >
                      {doc.title}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                        doc.classification === 'GENERATED'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-purple-50 text-purple-700 border border-purple-200'
                      }`}
                    >
                      {doc.classification}
                    </span>
                    {updatingId === doc.id && (
                      <Loader2 className="w-3 h-3 animate-spin text-blue-600" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {doc.notes}
                  </div>
                </div>
              </div>

              <div className="shrink-0">
                {doc.isVerified ? (
                  <span className="flex items-center gap-1 text-[11px] text-green-700 font-mono font-semibold">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>VERIFIED</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-blue-700 font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>PENDING</span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* New Master Order Modal */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4 border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <FolderCheck className="w-4 h-4 text-blue-700" />
                <span>Initialize Master Export Order</span>
              </h2>
              <button
                onClick={() => setShowNewOrderModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Order Date</label>
                <input
                  type="date"
                  value={newOrderDate}
                  onChange={(e) => setNewOrderDate(e.target.value)}
                  className="ef-input w-full"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Buyer PO Reference</label>
                <input
                  type="text"
                  value={newBuyerPo}
                  onChange={(e) => setNewBuyerPo(e.target.value)}
                  className="ef-input w-full"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Customer (Buyer)</label>
                <select
                  value={newCustomerId}
                  onChange={(e) => setNewCustomerId(e.target.value)}
                  className="ef-select w-full"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.country})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Total Quantity (MT)</label>
                  <input
                    type="number"
                    step="1"
                    value={newTotalMt}
                    onChange={(e) => setNewTotalMt(parseFloat(e.target.value) || 0)}
                    className="ef-input w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Incoterm</label>
                  <select
                    value={newIncoterm}
                    onChange={(e) => setNewIncoterm(e.target.value)}
                    className="ef-select w-full"
                  >
                    <option value="CIF">CIF</option>
                    <option value="CFR">CFR</option>
                    <option value="FOB">FOB</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Letter of Credit (LC) Number</label>
                <input
                  type="text"
                  value={newLcNumber}
                  onChange={(e) => setNewLcNumber(e.target.value)}
                  className="ef-input w-full font-mono"
                  placeholder="e.g. LC-EMIRATES-889900"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="ef-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateMasterOrder}
                disabled={orderCreating || newTotalMt <= 0}
                className="ef-btn ef-btn-primary flex items-center gap-1.5"
              >
                {orderCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Initialize Order & Docket</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
