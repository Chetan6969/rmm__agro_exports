'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import {
  FileText,
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  Boxes,
  Loader2,
  RefreshCw,
  CreditCard,
  X,
  FilePlus2,
  List,
} from 'lucide-react';
import {
  api,
  type CommercialInvoiceListItem,
  type Customer,
  type Product,
  type PackingType,
  type Port,
  type BankDetail,
} from '../../lib/api';

interface LineItemState {
  id: string;
  productId: string;
  packingTypeId: string;
  quantityMt: number;
  ratePerMt: number;
  amount: number;
  specifications?: string;
  cropYear?: string;
  hsCode?: string;
}

interface ContainerState {
  id: string;
  containerNumber: string;
  sealNumber: string;
  containerSize: string;
  totalBags: number;
  grossWeightKg: number;
  netWeightKg: number;
}

export function CommercialInvoiceForm() {
  const { activeCompany, financialYear } = useCompany();

  const [view, setView] = useState<'list' | 'create'>('list');
  const [invoices, setInvoices] = useState<CommercialInvoiceListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Receipt Modal State
  const [receiptInvoice, setReceiptInvoice] = useState<CommercialInvoiceListItem | null>(null);
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receiptAmount, setReceiptAmount] = useState<number>(0);
  const [receiptMode, setReceiptMode] = useState<string>('WIRE_TRANSFER');
  const [receiptRef, setReceiptRef] = useState<string>('');
  const [receiptSaving, setReceiptSaving] = useState(false);

  // Master data
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [packingTypes, setPackingTypes] = useState<PackingType[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [banks, setBanks] = useState<BankDetail[]>([]);

  // Create Form State
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [buyerPoNumber, setBuyerPoNumber] = useState('PO-UAE-9921');
  const [customerId, setCustomerId] = useState('');
  const [consigneeId, setConsigneeId] = useState('');
  const [portOfLoading, setPortOfLoading] = useState('Mundra Port, Gujarat, India');
  const [portOfDischarge, setPortOfDischarge] = useState('Jebel Ali Port, UAE');
  const [countryOfDestination, setCountryOfDestination] = useState('United Arab Emirates');
  const [incoterm, setIncoterm] = useState<'FOB' | 'CFR' | 'CIF'>('CIF');
  const [currency] = useState('USD');
  const [bankDetailsId, setBankDetailsId] = useState('');

  // Shipping charges
  const [oceanFreight, setOceanFreight] = useState<number>(1500.0);
  const [insurance, setInsurance] = useState<number>(100.0);
  const [thcCharge, setThcCharge] = useState<number>(250.0);
  const [blCharge, setBlCharge] = useState<number>(75.0);

  // Line items
  const [items, setItems] = useState<LineItemState[]>([
    {
      id: 'item-1',
      productId: '',
      packingTypeId: '',
      quantityMt: 50.0,
      ratePerMt: 1000.0,
      amount: 50000.0,
      specifications: 'Average Grain Length 8.35mm, Sortex Cleaned, Max 1% Broken',
      cropYear: '2025-2026',
      hsCode: '10063020',
    },
  ]);

  // Containers
  const [containers, setContainers] = useState<ContainerState[]>([
    {
      id: 'c-1',
      containerNumber: 'MSCU9876543',
      sealNumber: 'SEAL-001234',
      containerSize: '20FT',
      totalBags: 833,
      grossWeightKg: 25150.0,
      netWeightKg: 25000.0,
    },
    {
      id: 'c-2',
      containerNumber: 'TGHU1122334',
      sealNumber: 'SEAL-001235',
      containerSize: '20FT',
      totalBags: 833,
      grossWeightKg: 25150.0,
      netWeightKg: 25000.0,
    },
  ]);

  const loadInvoices = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const data = await api.listInvoices();
      setInvoices(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load commercial invoices');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMasterData = useCallback(async () => {
    try {
      const [c, p, pt, po, b] = await Promise.all([
        api.customers(),
        api.products(),
        api.packingTypes(),
        api.ports(),
        api.bankDetails(),
      ]);
      setCustomers(c);
      setProducts(p);
      setPackingTypes(pt);
      setPorts(po);
      setBanks(b);

      if (c.length > 0 && !customerId) {
        setCustomerId(c[0].id);
        setConsigneeId(c.length > 1 ? c[1].id : c[0].id);
      }
      if (b.length > 0 && !bankDetailsId) {
        setBankDetailsId(b[0].id);
      }
      if (items.length > 0 && (!items[0].productId || !items[0].packingTypeId)) {
        setItems([
          {
            ...items[0],
            productId: p[0]?.id || '',
            packingTypeId: pt[0]?.id || '',
          },
        ]);
      }
    } catch {
      // Offline fallback
    }
  }, [bankDetailsId, customerId, items]);

  useEffect(() => {
    void loadInvoices();
    void loadMasterData();
  }, [loadInvoices, loadMasterData]);

  // Dynamic calculations
  const totalFobAmount = items.reduce((sum, it) => sum + it.amount, 0);
  const freightApplied = incoterm === 'CFR' || incoterm === 'CIF' ? oceanFreight : 0;
  const insuranceApplied = incoterm === 'CIF' ? insurance : 0;
  const grandTotal = totalFobAmount + freightApplied + insuranceApplied;
  const totalQuantityMt = items.reduce((sum, it) => sum + it.quantityMt, 0);

  const handleUpdateLine = (id: string, field: 'quantityMt' | 'ratePerMt' | 'productId' | 'packingTypeId', val: any) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const updated = { ...it, [field]: val };
        updated.amount = Math.round(Number(updated.quantityMt) * Number(updated.ratePerMt) * 100) / 100;
        return updated;
      }),
    );
  };

  const handleAddLine = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}`,
        productId: products[0]?.id || '',
        packingTypeId: packingTypes[0]?.id || '',
        quantityMt: 25.0,
        ratePerMt: 900.0,
        amount: 22500.0,
        cropYear: '2025-2026',
        hsCode: '10063020',
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((it) => it.id !== id));
    }
  };

  const handleAddContainer = () => {
    setContainers((prev) => [
      ...prev,
      {
        id: `c-${Date.now()}`,
        containerNumber: `CONU${Math.floor(1000000 + Math.random() * 9000000)}`,
        sealNumber: `SEAL-${Math.floor(100000 + Math.random() * 900000)}`,
        containerSize: '20FT',
        totalBags: 833,
        grossWeightKg: 25150,
        netWeightKg: 25000,
      },
    ]);
  };

  const handleRemoveContainer = (id: string) => {
    if (containers.length > 1) {
      setContainers((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const handleSaveInvoice = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        documentDate,
        buyerPoNumber: buyerPoNumber || undefined,
        customerId: customerId || customers[0]?.id || '00000000-0000-0000-0000-000000000001',
        consigneeId: consigneeId || undefined,
        portOfLoading,
        portOfDischarge,
        countryOfDestination,
        incoterm,
        currency,
        bankDetailsId: bankDetailsId || undefined,
        items: items.map((it) => ({
          productId: it.productId || products[0]?.id || '00000000-0000-0000-0000-000000000001',
          packingTypeId: it.packingTypeId || packingTypes[0]?.id || '00000000-0000-0000-0000-000000000001',
          quantityMt: Number(it.quantityMt),
          ratePerMt: Number(it.ratePerMt),
          amount: it.amount,
          specifications: it.specifications,
          cropYear: it.cropYear,
          hsCode: it.hsCode,
        })),
        shippingCharges: {
          thcCharge,
          blCharge,
          oceanFreightCharge: oceanFreight,
          insuranceCharge: insurance,
        },
        containers: containers.map((c) => ({
          containerNumber: c.containerNumber,
          sealNumber: c.sealNumber,
          containerSize: c.containerSize,
          totalBags: c.totalBags,
          grossWeightKg: c.grossWeightKg,
          netWeightKg: c.netWeightKg,
        })),
      };

      const res = await api.createInvoice(payload);
      setToast(`Commercial Invoice ${res.documentNumber} issued successfully!`);
      setView('list');
      await loadInvoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save commercial invoice');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenReceiptModal = (inv: CommercialInvoiceListItem) => {
    setReceiptInvoice(inv);
    setReceiptAmount(Number(inv.totalInvoiceAmount) || 0);
    setReceiptRef(`SWIFT-${Math.floor(100000 + Math.random() * 900000)}`);
  };

  const handleSaveReceipt = async () => {
    if (!receiptInvoice) return;
    setReceiptSaving(true);
    try {
      await api.createReceipt({
        receiptDate,
        commercialInvoiceId: receiptInvoice.id,
        customerId: receiptInvoice.customerId,
        amountReceived: receiptAmount,
        currency: receiptInvoice.currency,
        paymentMode: receiptMode,
        referenceNumber: receiptRef,
      });
      setReceiptInvoice(null);
      setToast(`Payment receipt recorded for ${receiptInvoice.documentNumber}.`);
      await loadInvoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record receipt');
    } finally {
      setReceiptSaving(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.documentNumber.toLowerCase().includes(q) ||
        (inv.customerName || '').toLowerCase().includes(q),
    );
  }, [invoices, search]);

  const fmt = (n: string | number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 border-b border-slate-200 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-700" />
              <span>Commercial Export Invoices</span>
            </h1>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold border border-blue-200">
              {activeCompany.code} • FY {financialYear}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Authoritative commercial invoices, container packing lists, and automated Rule 7 Incoterm pricing
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(view === 'list' ? 'create' : 'list')}
            className="ef-btn ef-btn-primary flex items-center gap-1.5"
          >
            {view === 'list' ? (
              <>
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>New Invoice</span>
              </>
            ) : (
              <>
                <List className="w-3.5 h-3.5" />
                <span>Back to Invoices</span>
              </>
            )}
          </button>
          <a
            href={api.commercialInvoicePdfUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="ef-btn flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5 text-blue-600" />
            <span>Sample A4 PDF</span>
          </a>
        </div>
      </div>

      {toast && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-green-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            <span>{toast}</span>
          </div>
          <button onClick={() => setToast(null)} className="text-slate-400 hover:text-slate-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {view === 'list' ? (
        /* Invoices List View */
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search invoice number or buyer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ef-input w-64 text-xs"
            />
            <button onClick={loadInvoices} className="ef-btn flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          <div className="ef-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="ef-table text-xs">
                <thead>
                  <tr>
                    <th>Invoice No</th>
                    <th>Customer / Buyer</th>
                    <th>Date</th>
                    <th>Incoterm</th>
                    <th className="text-right">Total Amount</th>
                    <th>Status</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList && (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin inline" /> Loading invoices…
                      </td>
                    </tr>
                  )}
                  {!loadingList && filteredInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-slate-400">
                        No commercial invoices recorded yet. Click &quot;New Invoice&quot; to issue one.
                      </td>
                    </tr>
                  )}
                  {!loadingList &&
                    filteredInvoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className={`cursor-pointer ${selectedInvoiceId === inv.id ? 'selected' : ''}`}
                        onClick={() => setSelectedInvoiceId(inv.id)}
                      >
                        <td className="font-mono font-semibold text-slate-800">{inv.documentNumber}</td>
                        <td className="text-slate-700">{inv.customerName || 'Al-Barakah General Trading LLC'}</td>
                        <td className="font-mono text-slate-600">{inv.documentDate}</td>
                        <td>
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200">
                            {inv.incoterm}
                          </span>
                        </td>
                        <td className="text-right font-mono font-semibold text-slate-800">
                          {inv.currency} {fmt(inv.totalInvoiceAmount)}
                        </td>
                        <td>
                          <span
                            className={`ef-chip ${
                              inv.status === 'PAID'
                                ? 'ef-chip-confirmed'
                                : inv.status === 'PARTIALLY_PAID'
                                  ? 'ef-chip-open'
                                  : 'ef-chip-open'
                            }`}
                          >
                            {inv.status}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <a
                              href={api.commercialInvoicePdfUrl()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 text-slate-500 hover:text-blue-600"
                              title="Print PDF"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </a>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenReceiptModal(inv);
                              }}
                              className="p-1 text-slate-500 hover:text-green-600"
                              title="Record Payment Receipt"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
              {filteredInvoices.length} invoice(s) found
            </div>
          </div>
        </div>
      ) : (
        /* Invoice Creation Form */
        <div className="space-y-5">
          {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg bg-white border border-slate-200 text-xs">
            <div>
              <label className="block text-slate-600 font-semibold mb-1">Document Date</label>
              <input
                type="date"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
                className="ef-input w-full"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Buyer PO Reference</label>
              <input
                type="text"
                value={buyerPoNumber}
                onChange={(e) => setBuyerPoNumber(e.target.value)}
                className="ef-input w-full"
                placeholder="e.g. PO-UAE-9921"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Incoterm (Rule 7 Pricing)</label>
              <select
                value={incoterm}
                onChange={(e) => setIncoterm(e.target.value as 'FOB' | 'CFR' | 'CIF')}
                className="ef-select w-full font-mono font-bold text-blue-700"
              >
                <option value="FOB">FOB — Free On Board</option>
                <option value="CFR">CFR — Cost & Freight</option>
                <option value="CIF">CIF — Cost, Insurance & Freight</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Customer (Buyer)</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="ef-select w-full"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.country})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Consignee (Rule 10)</label>
              <select
                value={consigneeId}
                onChange={(e) => setConsigneeId(e.target.value)}
                className="ef-select w-full"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.country})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Bank Remittance Account</label>
              <select
                value={bankDetailsId}
                onChange={(e) => setBankDetailsId(e.target.value)}
                className="ef-select w-full"
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bankName} - {b.accountNumber}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Port of Loading</label>
              <input
                type="text"
                value={portOfLoading}
                onChange={(e) => setPortOfLoading(e.target.value)}
                className="ef-input w-full"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Port of Discharge</label>
              <input
                type="text"
                value={portOfDischarge}
                onChange={(e) => setPortOfDischarge(e.target.value)}
                className="ef-input w-full"
              />
            </div>

            <div>
              <label className="block text-slate-600 font-semibold mb-1">Country of Final Destination</label>
              <input
                type="text"
                value={countryOfDestination}
                onChange={(e) => setCountryOfDestination(e.target.value)}
                className="ef-input w-full"
              />
            </div>
          </div>

          {/* Export Product Lines */}
          <div className="p-4 rounded-lg bg-white border border-slate-200 text-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <span className="font-bold text-slate-700">Export Rice Specifications & Quantities</span>
              <button
                type="button"
                onClick={handleAddLine}
                className="ef-btn ef-btn-primary flex items-center gap-1 text-[11px]"
              >
                <Plus className="w-3 h-3" />
                <span>Add Product Line</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="ef-table text-xs">
                <thead>
                  <tr>
                    <th>Product / Variety</th>
                    <th>Packing Style</th>
                    <th className="text-right">Quantity (MT)</th>
                    <th className="text-right">Rate / MT (USD)</th>
                    <th className="text-right">Line Total (USD)</th>
                    <th className="text-center w-12">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <select
                          value={line.productId}
                          onChange={(e) => handleUpdateLine(line.id, 'productId', e.target.value)}
                          className="ef-select w-full"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={line.packingTypeId}
                          onChange={(e) => handleUpdateLine(line.id, 'packingTypeId', e.target.value)}
                          className="ef-select w-full"
                        >
                          {packingTypes.map((pt) => (
                            <option key={pt.id} value={pt.id}>
                              {pt.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          step="0.001"
                          value={line.quantityMt}
                          onChange={(e) =>
                            handleUpdateLine(line.id, 'quantityMt', parseFloat(e.target.value) || 0)
                          }
                          className="ef-input w-24 text-right font-mono"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={line.ratePerMt}
                          onChange={(e) =>
                            handleUpdateLine(line.id, 'ratePerMt', parseFloat(e.target.value) || 0)
                          }
                          className="ef-input w-24 text-right font-mono"
                        />
                      </td>
                      <td className="text-right font-mono font-bold text-slate-800">
                        ${fmt(line.amount)}
                      </td>
                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(line.id)}
                          disabled={items.length === 1}
                          className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Containers & Shipping Charges Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Containers Table */}
            <div className="p-4 rounded-lg bg-white border border-slate-200 text-xs space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Boxes className="w-4 h-4 text-blue-600" />
                  <span>Container Packing Allocation</span>
                </span>
                <button
                  type="button"
                  onClick={handleAddContainer}
                  className="ef-btn text-[11px] flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Container</span>
                </button>
              </div>

              <div className="space-y-2">
                {containers.map((c, i) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between py-1.5 border-b border-slate-100 font-mono text-[11px]"
                  >
                    <span className="font-semibold text-slate-700">
                      {i + 1}. {c.containerNumber} ({c.containerSize})
                    </span>
                    <span className="text-slate-500">Seal: {c.sealNumber}</span>
                    <span className="text-blue-700">{c.totalBags} bags</span>
                    <span className="text-slate-600">{c.grossWeightKg.toLocaleString()} KG</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveContainer(c.id)}
                      disabled={containers.length === 1}
                      className="text-slate-400 hover:text-red-500 disabled:opacity-30"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Calculations & Summary */}
            <div className="p-4 rounded-lg bg-white border border-slate-200 text-xs space-y-2.5">
              <div className="font-bold text-slate-700 pb-2 border-b border-slate-200 flex justify-between">
                <span>Rule 7 Authoritative Totals</span>
                <span className="text-blue-700 font-mono">{incoterm}</span>
              </div>

              <div className="flex justify-between text-slate-600">
                <span>Total Quantity:</span>
                <span className="font-mono text-slate-800">{totalQuantityMt.toFixed(3)} MT</span>
              </div>

              <div className="flex justify-between text-slate-600">
                <span>Total FOB Goods Value:</span>
                <span className="font-mono text-slate-800">${fmt(totalFobAmount)}</span>
              </div>

              {(incoterm === 'CFR' || incoterm === 'CIF') && (
                <div className="flex justify-between items-center text-slate-600">
                  <span>Ocean Freight Charge:</span>
                  <input
                    type="number"
                    step="0.01"
                    value={oceanFreight}
                    onChange={(e) => setOceanFreight(parseFloat(e.target.value) || 0)}
                    className="ef-input w-24 text-right font-mono"
                  />
                </div>
              )}

              {incoterm === 'CIF' && (
                <div className="flex justify-between items-center text-slate-600">
                  <span>Marine Cargo Insurance:</span>
                  <input
                    type="number"
                    step="0.01"
                    value={insurance}
                    onChange={(e) => setInsurance(parseFloat(e.target.value) || 0)}
                    className="ef-input w-24 text-right font-mono"
                  />
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-bold text-slate-800">
                <span>Grand Total ({currency}):</span>
                <span className="text-base font-mono text-green-700">${fmt(grandTotal)}</span>
              </div>

              <div className="pt-3">
                <button
                  type="button"
                  onClick={handleSaveInvoice}
                  disabled={saving}
                  className="w-full ef-btn ef-btn-primary py-2 text-xs font-bold flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Issue & Authorize Commercial Invoice</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Receipt Modal */}
      {receiptInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-4 border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-green-600" />
                <span>Record Payment Receipt</span>
              </h2>
              <button
                onClick={() => setReceiptInvoice(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Invoice</label>
                <input
                  type="text"
                  disabled
                  value={`${receiptInvoice.documentNumber} (${receiptInvoice.currency} ${fmt(receiptInvoice.totalInvoiceAmount)})`}
                  className="ef-input w-full bg-slate-50 font-mono text-slate-600"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Receipt Date</label>
                <input
                  type="date"
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  className="ef-input w-full"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Amount Received (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(parseFloat(e.target.value) || 0)}
                  className="ef-input w-full font-mono text-slate-800 font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Payment Method</label>
                <select
                  value={receiptMode}
                  onChange={(e) => setReceiptMode(e.target.value)}
                  className="ef-select w-full"
                >
                  <option value="WIRE_TRANSFER">Wire Transfer / TT (Telegraphic Transfer)</option>
                  <option value="LC_NEGOTIATION">Letter of Credit (LC) Negotiation</option>
                  <option value="CHEQUE">Cheque / Demand Draft</option>
                  <option value="OTHER">Other Foreign Remittance</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">SWIFT / Bank Reference</label>
                <input
                  type="text"
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                  className="ef-input w-full font-mono"
                  placeholder="e.g. SWIFT-88776655"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setReceiptInvoice(null)}
                className="ef-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveReceipt}
                disabled={receiptSaving || receiptAmount <= 0}
                className="ef-btn ef-btn-primary flex items-center gap-1.5"
              >
                {receiptSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm & Record Receipt</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
