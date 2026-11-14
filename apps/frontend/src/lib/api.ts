'use client';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (Array.isArray(body?.message)) message = body.message.join(', ');
      else if (body?.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Auth / company ----
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  role: string;
}
export interface CompanyBrief {
  id: string;
  code: string;
  name: string;
  legalName: string;
}
export interface CompanyDetail {
  id: string;
  code: string;
  name: string;
  legalName: string;
  gstin: string | null;
  iecCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  contactEmail: string | null;
}
export interface LoginResult {
  user: AuthUser;
  activeCompany: CompanyBrief;
  companies: CompanyBrief[];
}

// ---- Master data ----
export interface Customer {
  id: string;
  name: string;
  address: string;
  city: string | null;
  country: string;
  isBuyer: boolean;
  isConsignee: boolean;
  isNotifyParty: boolean;
}
export interface Product {
  id: string;
  name: string;
  variety: string;
  processingType: string;
  hsnCode: string;
  grainLengthMm: string | null;
  moistureMaxPercentage: string | null;
  defaultBrokenPercentage: string;
}
export interface PackingType {
  id: string;
  name: string;
  material: string;
  weightKg: string;
}
export interface Port {
  id: string;
  name: string;
  code: string | null;
  portType: string;
  country: string;
}
export interface BankDetail {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifscCode: string | null;
  swiftCode: string;
  adCode: string;
  isDefault: boolean;
}
export interface Term {
  id: string;
  title: string;
  content: string;
  isDefault: boolean;
  documentType: string;
}

// ---- Proforma ----
export interface ProformaListItem {
  id: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  incoterm: string;
  currency: string;
  totalAmount: string;
  grandTotal: string;
  consigneeName: string | null;
  buyerName: string | null;
}

export interface ProformaLineInput {
  productId: string;
  packingTypeId: string;
  packingText?: string;
  hsCode?: string;
  cropYear?: string;
  quantityMt: number;
  ratePerMt: number;
  brokenPct?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  specifications?: string;
}

export interface CreateProformaInput {
  documentNumber?: string;
  documentDate: string;
  status?: string;
  customerId: string;
  consigneeId?: string;
  notifyPartyId?: string;
  buyerPoRef?: string;
  poDate?: string;
  lcNumber?: string;
  lcDate?: string;
  incoterm: 'FOB' | 'CFR' | 'CIF';
  currency?: string;
  exchangeRate?: number;
  paymentTerms: string;
  deliveryTimeline?: string;
  countryOfOrigin?: string;
  goodsCountry?: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  modeOfShipment?: string;
  brand?: string;
  blend?: string;
  specVariety?: string;
  specAvgLengthMm?: number;
  specMoisturePct?: number;
  specBrokenPct?: number;
  specCropYear?: string;
  bankDetailsId?: string;
  freightAmount?: number;
  insuranceAmount?: number;
  discountAmount?: number;
  showNotifyParty?: boolean;
  showShippingDetails?: boolean;
  showSpecification?: boolean;
  showBankDetails?: boolean;
  showLcDetails?: boolean;
  showTermsConditions?: boolean;
  showSignatureBlock?: boolean;
  terms?: { termId?: string; content: string }[];
  items: ProformaLineInput[];
}

export interface FieldUsage {
  field: string;
  rows: { value: string; count: number; totalAmount: number }[];
}

// ---- Production orders ----
export interface ProductionOrderListItem {
  id: string;
  documentNumber: string;
  documentDate: string;
  status: string;
  incoterm: string;
  totalQuantityMt: string;
  customerName: string | null;
  invoiceCount: number;
}

export interface ProductionLineInput {
  productId: string;
  packingTypeId?: string;
  packingText?: string;
  hsCode?: string;
  cropYear?: string;
  noOfBags?: number;
  quantityMt: number;
  grossWtMt?: number;
  ratePerMt?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  brokenBelow?: boolean;
  fcl?: boolean;
  specifications?: string;
}

export interface CreateProductionOrderInput {
  documentNumber?: string;
  documentDate: string;
  status?: string;
  proformaInvoiceId?: string;
  buyerPoNumber?: string;
  buyerPoRef?: string;
  poDate?: string;
  customerId?: string;
  consigneeId?: string;
  notifyPartyId?: string;
  incoterm?: string;
  currency?: string;
  exchangeRate?: number;
  lcNumber?: string;
  lcDate?: string;
  freightAmount?: number;
  insuranceAmount?: number;
  fcl?: string;
  preCarriageBy?: string;
  placeOfReceipt?: string;
  countryOfOrigin?: string;
  countryFinalDestination?: string;
  vesselFlightNo?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  destinationCountry?: string;
  termsOf?: string;
  paymentTerm?: string;
  brand?: string;
  transport?: string;
  vehicleNo?: string;
  orderRemark?: string;
  specVariety?: string;
  specAvgLengthMm?: number;
  specMoisturePct?: number;
  specBrokenPct?: number;
  specCropYear?: string;
  millingInstructions?: string;
  packagingInstructions?: string;
  showSignature?: boolean;
  terms?: { termId?: string; content: string }[];
  items: ProductionLineInput[];
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () =>
    request<{ user: AuthUser; activeCompanyId: string; activeCompanyCode: string }>(
      '/auth/me',
    ),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
  company: (id: string) => request<CompanyDetail>(`/companies/${id}`),

  customers: () => request<Customer[]>('/master-data/customers'),
  products: () => request<Product[]>('/master-data/products'),
  packingTypes: () => request<PackingType[]>('/master-data/packing-types'),
  ports: () => request<Port[]>('/master-data/ports'),
  bankDetails: () => request<BankDetail[]>('/master-data/bank-details'),
  terms: (documentType = 'PROFORMA') =>
    request<Term[]>(`/master-data/terms?documentType=${documentType}`),

  listProformas: () => request<ProformaListItem[]>('/sales/proformas'),
  getProforma: (id: string) => request<ProformaDetail>(`/sales/proformas/${id}`),
  createProforma: (dto: CreateProformaInput) =>
    request<{ id: string; documentNumber: string }>('/sales/proformas', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  deleteProforma: (id: string) =>
    request<{ message: string }>(`/sales/proformas/${id}`, { method: 'DELETE' }),
  proformaFieldUsage: (field: string) =>
    request<FieldUsage>(`/sales/proformas/reports/field-usage?field=${field}`),
  proformaTermsUsage: () =>
    request<{ value: string; count: number }[]>(
      '/sales/proformas/reports/terms-usage',
    ),
  proformaPdfUrl: (id: string) => `${API_BASE}/sales/proformas/${id}/pdf`,

  listProductionOrders: () =>
    request<ProductionOrderListItem[]>('/sales/production-orders'),
  createProductionOrder: (dto: CreateProductionOrderInput) =>
    request<{ id: string; documentNumber: string }>('/sales/production-orders', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  deleteProductionOrder: (id: string) =>
    request<{ message: string }>(`/sales/production-orders/${id}`, {
      method: 'DELETE',
    }),
  productionOrderPdfUrl: (id: string) =>
    `${API_BASE}/sales/production-orders/${id}/pdf`,

  // ---- Commercial Invoices & Packing Lists ----
  listInvoices: () =>
    request<CommercialInvoiceListItem[]>('/sales/invoices'),
  getInvoice: (id: string) =>
    request<CommercialInvoiceDetail>(`/sales/invoices/${id}`),
  createInvoice: (dto: CreateCommercialInvoiceInput) =>
    request<{ id: string; documentNumber: string }>('/sales/invoices', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  commercialInvoicePdfUrl: () => `${API_BASE}/pdf/sample-invoice`,
  samplePackingListPdfUrl: () => `${API_BASE}/pdf/sample-packing-list`,

  // ---- Receipts ----
  listReceipts: () => request<ReceiptListItem[]>('/sales/receipts'),
  createReceipt: (dto: CreateReceiptInput) =>
    request<ReceiptListItem>('/sales/receipts', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  // ---- Document Hub & Shipment Lots ----
  listOrders: () => request<MasterOrderItem[]>('/documents/orders'),
  getOrderDetails: (id: string) => request<any>(`/documents/orders/${id}`),
  createMasterOrder: (dto: CreateMasterOrderInput) =>
    request<MasterOrderItem>('/documents/orders', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  addLot: (dto: { masterOrderId: string; lotNumber: string; allocatedMt: number }) =>
    request<any>('/documents/lots', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
  updateDocumentStatus: (
    id: string,
    dto: { status: 'PENDING' | 'DRAFTED' | 'COLLECTED' | 'VERIFIED'; notes?: string; referenceNumber?: string },
  ) =>
    request<DocumentHubChecklistItem>(`/documents/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),

  // ---- Reports & Registers ----
  getSalesOrderRegister: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/reports/sales-order-register${qs}`);
  },
  getInvoiceRegister: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/reports/invoice-register${qs}`);
  },
  getPendingPayments: () => request<any[]>('/reports/pending-payments'),
  getSalesByCustomer: () => request<any[]>('/reports/sales-by-customer'),
  getReceiptsRegister: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any[]>(`/reports/receipts-register${qs}`);
  },
  getShippingAndCostRegister: () => request<any[]>('/reports/shipping-and-cost'),
  getDashboardMetrics: () => request<DashboardMetrics>('/reports/dashboard'),
};

export interface CommercialInvoiceListItem {
  id: string;
  documentNumber: string;
  documentDate: string;
  customerId: string;
  customerName?: string;
  incoterm: 'FOB' | 'CFR' | 'CIF';
  currency: string;
  totalInvoiceAmount: string;
  totalQuantityMt?: string;
  status: string;
}

export interface InvoiceItemInput {
  productId: string;
  packingTypeId: string;
  packingDescription?: string;
  quantityMt: number;
  ratePerMt: number;
  amount?: number;
  hsCode?: string;
  cropYear?: string;
  specifications?: string;
}

export interface ContainerInput {
  containerNumber: string;
  sealNumber: string;
  containerSize: string;
  totalBags: number;
  grossWeightKg: number;
  netWeightKg: number;
}

export interface ShippingChargesInput {
  thcCharge?: number;
  blCharge?: number;
  sealCharge?: number;
  mucCharge?: number;
  riskCharge?: number;
  repositionCharge?: number;
  oceanFreightCharge?: number;
  insuranceCharge?: number;
}

export interface CreateCommercialInvoiceInput {
  documentDate: string;
  proformaInvoiceId?: string;
  productionOrderId?: string;
  buyerPoNumber?: string;
  customerId: string;
  consigneeId?: string;
  notifyPartyId?: string;
  shippingBillNumber?: string;
  blNumber?: string;
  vesselFlightName?: string;
  portOfLoading: string;
  portOfDischarge: string;
  countryOfDestination: string;
  incoterm: 'FOB' | 'CFR' | 'CIF';
  currency?: string;
  bankDetailsId?: string;
  items: InvoiceItemInput[];
  shippingCharges?: ShippingChargesInput;
  containers?: ContainerInput[];
}

export interface CommercialInvoiceDetail {
  invoice: any;
  items: any[];
  shippingCharges: any;
  containers: any[];
}

export interface ReceiptListItem {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  commercialInvoiceId: string;
  invoiceNumber?: string;
  customerName?: string;
  amountReceived: string;
  currency: string;
  paymentMode: string;
  referenceNumber?: string;
  status: string;
}

export interface CreateReceiptInput {
  receiptDate: string;
  commercialInvoiceId: string;
  customerId: string;
  amountReceived: number;
  currency?: string;
  paymentMode: string;
  referenceNumber?: string;
  remarks?: string;
  bankDetailsId?: string;
}

export interface MasterOrderItem {
  id: string;
  documentNumber: string;
  orderDate?: string;
  buyerPoNumber?: string;
  customerId: string;
  customerName?: string;
  totalQuantityMt: string;
  allocatedLotsMt?: string;
  remainingMt?: string;
  incoterm: string;
  status: string;
  lots?: Array<{
    id: string;
    lotNumber: string;
    allocatedMt: string;
    readinessPct?: number;
  }>;
}

export interface DocumentHubChecklistItem {
  id: string;
  lotId?: string;
  documentType: string;
  classification: 'GENERATED' | 'COLLECTED';
  status: 'PENDING' | 'DRAFTED' | 'COLLECTED' | 'VERIFIED';
  notes?: string;
  referenceNumber?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface CreateMasterOrderInput {
  orderDate: string;
  buyerPoNumber?: string;
  customerId: string;
  totalQuantityMt: number;
  incoterm: string;
  destinationCountry: string;
  portOfLoading: string;
  portOfDischarge: string;
  currency?: string;
  lcNumber?: string;
  lcExpiryDate?: string;
}

export interface DashboardMetrics {
  totalSalesUsd: number;
  totalOutstandingDueUsd: number;
  activeOrdersCount: number;
  pendingProductionOrdersCount: number;
  recentActivity: Array<{
    id: string;
    action: string;
    entityTable: string;
    entityId: string;
    createdAt: string;
  }>;
}

export interface ProformaDetailItem {
  id: string;
  lineNumber: number;
  productName: string | null;
  packingName: string | null;
  packingText: string | null;
  hsCode: string | null;
  cropYear: string | null;
  quantityMt: string;
  ratePerMt: string;
  amount: string;
  specifications: string | null;
}
export interface ProformaDetail {
  proforma: {
    id: string;
    documentNumber: string;
    documentDate: string;
    status: string;
    customerId: string;
    consigneeId: string | null;
    notifyPartyId: string | null;
    incoterm: string;
    currency: string;
    paymentTerms: string;
    brand: string | null;
    blend: string | null;
    portOfLoading: string;
    portOfDischarge: string;
    finalDestination: string;
    specVariety: string | null;
    specAvgLengthMm: string | null;
    specMoisturePct: string | null;
    specBrokenPct: string | null;
    specCropYear: string | null;
    grandTotal: string;
    totalAmount: string;
  };
  items: ProformaDetailItem[];
  terms: { id: string; content: string; position: number }[];
  consignee: { name: string; address: string; country: string } | null;
  buyer: { name: string; address: string; country: string } | null;
  notifyParty: { name: string; address: string; country: string } | null;
  bank: { bankName: string; accountNumber: string; swiftCode: string } | null;
}
