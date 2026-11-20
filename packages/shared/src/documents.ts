/**
 * Sales document registry: Proforma Invoice → Production Order → Commercial Invoice.
 *
 * Like the master registry, one definition drives the PostgreSQL tables, API validation,
 * totals, the form screens and the PDFs. Totals are computed here with exact decimals and
 * used by both the API (authoritative, stored) and the web form (live preview).
 */
import type { FieldDef } from './entities.js';
import { add, computeShippingCharges, INCOTERMS, mul, round, sub, type DecimalInput } from './money.js';

export type DocKey = 'proformaInvoices' | 'productionOrders' | 'commercialInvoices' | 'oceanBills' | 'certificates';

export interface TotalDef {
  name: string;
  label: string;
  scale: number;
}

export interface DocDef {
  key: DocKey;
  label: string;
  plural: string;
  /** Short name used in menus and PDF file names. */
  short: string;
  table: string;
  /** Line / terms child tables — omitted for header-only documents (OBL, certificates). */
  linesTable?: string;
  termsTable?: string;
  /** Permission module ("module:action"). */
  module: string;
  /** Numbering series (DOC_TYPES key). */
  numbering: string;
  /** T&C templates of this document type are offered on the form (invoice-style docs only). */
  tcDocType?: string;
  statuses: readonly string[];
  defaultStatus: string;
  /** Header field linking to the document this one is generated against, if any. */
  parent?: { doc: DocKey; field: string };
  header: FieldDef[];
  /** Empty for header-only documents (letter/certificate style). */
  lines: FieldDef[];
  totals: TotalDef[];
  /** Commercial invoices carry the container list for the packing list. */
  containers?: boolean;
  /** A header-only letter document rendered from a certificate template (no lines/totals/terms). */
  letter?: boolean;
}

/** A document that no longer counts (balances, reports). */
export const CANCELLED = 'CANCELLED';

// ------------------------------------------------------------------ shared field blocks
const docNumber = (label: string): FieldDef => ({
  name: 'documentNumber',
  label,
  type: 'text',
  maxLength: 64,
  list: true,
  search: true,
  section: 'Document',
  help: 'Leave blank to take the next number from Document numbering',
});
const docDate: FieldDef = { name: 'documentDate', label: 'Date', type: 'date', required: true, list: true };
const status = (options: readonly string[], dflt: string): FieldDef => ({
  name: 'status',
  label: 'Status',
  type: 'select',
  options,
  default: dflt,
  required: true,
  list: true,
});

const parties = (buyerRequired: boolean): FieldDef[] => [
  { name: 'buyerId', label: 'Buyer', type: 'ref', ref: 'customers', required: buyerRequired, list: true, section: 'Parties', span: 2, allowCreate: true },
  { name: 'consigneeId', label: 'Consignee (if not the buyer)', type: 'ref', ref: 'customers', span: 1, allowCreate: true, sameAs: 'buyerId' },
  { name: 'notifyPartyId', label: 'Notify party', type: 'ref', ref: 'customers', allowCreate: true, sameAs: 'buyerId' },
];

const buyerRefs: FieldDef[] = [
  { name: 'buyerPoRef', label: "Buyer's PO / reference", type: 'text', maxLength: 128, search: true, section: 'References' },
  { name: 'poDate', label: 'PO date', type: 'date' },
  { name: 'lcNumber', label: 'LC no.', type: 'text', upper: true, maxLength: 64, search: true },
  { name: 'lcDate', label: 'LC date', type: 'date' },
];

const commercial: FieldDef[] = [
  { name: 'incoterm', label: 'Incoterm', type: 'select', options: INCOTERMS, required: true, default: 'FOB', list: true, section: 'Commercial terms' },
  { name: 'currencyId', label: 'Currency', type: 'ref', ref: 'currencies', required: true, list: true },
  {
    name: 'exchangeRate',
    label: 'Exchange rate (₹ per unit)',
    type: 'decimal',
    precision: 12,
    scale: 4,
    required: true,
    help: 'Filled from the live rate when you pick the currency; edit if the bank rate differs',
  },
  { name: 'paymentTermId', label: 'Payment term', type: 'ref', ref: 'paymentTerms' },
  { name: 'paymentTerms', label: 'Payment terms (printed)', type: 'textarea', span: 2, help: 'Filled from the payment term master; edit for this document' },
];

const shippingRoute: FieldDef[] = [
  { name: 'originCountryId', label: 'Country of origin', type: 'ref', ref: 'countries', section: 'Shipping' },
  { name: 'portOfLoadingId', label: 'Port of loading', type: 'ref', ref: 'ports' },
  { name: 'portOfDischargeId', label: 'Port of discharge', type: 'ref', ref: 'ports', list: true },
  { name: 'destinationCountryId', label: 'Destination country', type: 'ref', ref: 'countries' },
  { name: 'finalDestination', label: 'Final destination (place)', type: 'text', maxLength: 128 },
];

const spec: FieldDef[] = [
  { name: 'specVariety', label: 'Variety & grade', type: 'text', maxLength: 128, section: 'Specification', span: 2 },
  { name: 'specAvgLengthMm', label: 'Avg. grain length (mm)', type: 'decimal', precision: 6, scale: 2 },
  { name: 'specMoisturePct', label: 'Moisture % (max)', type: 'decimal', precision: 5, scale: 2 },
  { name: 'specBrokenPct', label: 'Broken % (max)', type: 'decimal', precision: 5, scale: 2 },
  { name: 'specCropYear', label: 'Crop year', type: 'text', maxLength: 16 },
];

const gst: FieldDef[] = [
  { name: 'cgst', label: 'CGST', type: 'decimal', precision: 15, scale: 2, default: 0 },
  { name: 'sgst', label: 'SGST', type: 'decimal', precision: 15, scale: 2, default: 0 },
  { name: 'igst', label: 'IGST', type: 'decimal', precision: 15, scale: 2, default: 0, help: 'Nil for exports under LUT' },
];

const productLine = (rateRequired: boolean): FieldDef[] => [
  // Packing rows that belong to the same product card share a group number (managed
  // by the line editor); lists and PDFs print them under one product heading.
  { name: 'packGroup', label: 'Packing group', type: 'integer', default: 0, hidden: true },
  { name: 'productId', label: 'Product', type: 'ref', ref: 'products', required: true, list: true, span: 2, allowCreate: true },
  { name: 'brand', label: 'Brand', type: 'text', maxLength: 128 },
  { name: 'packingTypeId', label: 'Packing', type: 'ref', ref: 'packingTypes', list: true, allowCreate: true },
  { name: 'packingText', label: 'Packing details (printed)', type: 'textarea', span: 3, help: 'e.g. 40 KG non-woven bags, 1000 MT' },
  { name: 'packingNote', label: 'Extra printed note', type: 'textarea', span: 3, help: 'Extra line(s) printed under this packing on the invoice' },
  { name: 'hsCode', label: 'HS code', type: 'text', maxLength: 16 },
  { name: 'cropYear', label: 'Crop year', type: 'text', maxLength: 16 },
  { name: 'noOfBags', label: 'No. of bags', type: 'integer', default: 0, list: true },
  // MT one 20ft container holds in this packing (copied from the packing master); drives the
  // auto-calculated "<n> X 20' FCL SAID TO CONTAIN" line. Kept per line so reports stay exact.
  { name: 'containerCapacityMt', label: 'Container load (MT / 20ft)', type: 'decimal', precision: 12, scale: 3, hidden: true },
  { name: 'quantityMt', label: 'Net weight (MT)', type: 'decimal', precision: 12, scale: 3, required: true, list: true },
  { name: 'grossWtMt', label: 'Gross weight (MT)', type: 'decimal', precision: 12, scale: 3 },
  { name: 'ratePerMt', label: 'Rate per MT', type: 'decimal', precision: 15, scale: 2, required: rateRequired, list: true },
];

const lineExtras: FieldDef[] = [
  { name: 'brokenPct', label: 'Broken %', type: 'decimal', precision: 5, scale: 2 },
  ...gst,
  { name: 'specifications', label: 'Description / specification', type: 'textarea', span: 3 },
];

const productionFlags: FieldDef[] = [
  { name: 'brokenBelow', label: 'Broken below spec', type: 'boolean', default: false },
  { name: 'fcl', label: 'FCL', type: 'boolean', default: false },
];

// ------------------------------------------------------------------ documents
export const DOC_LIST: DocDef[] = [
  {
    key: 'proformaInvoices',
    label: 'Proforma invoice',
    plural: 'Proforma invoices',
    short: 'PI',
    table: 'proforma_invoices',
    linesTable: 'proforma_invoice_lines',
    termsTable: 'proforma_invoice_terms',
    module: 'sales.proformaInvoices',
    numbering: 'proforma_invoice',
    tcDocType: 'Proforma Invoice',
    statuses: ['DRAFT', 'CONFIRMED', 'FULFILLED', CANCELLED],
    defaultStatus: 'CONFIRMED',
    header: [
      docNumber('Proforma invoice no.'),
      docDate,
      status(['DRAFT', 'CONFIRMED', 'FULFILLED', CANCELLED], 'CONFIRMED'),
      ...parties(true),
      ...buyerRefs,
      ...commercial,
      { name: 'deliveryTimeline', label: 'Delivery / shipment period', type: 'text', maxLength: 255 },
      ...shippingRoute,
      { name: 'modeOfShipment', label: 'Mode of shipment', type: 'text', maxLength: 64, help: 'e.g. By sea, FCL container' },
      { name: 'brand', label: 'Brand', type: 'text', maxLength: 128, section: 'Goods' },
      { name: 'blend', label: 'Blend', type: 'text', maxLength: 128 },
      ...spec,
      { name: 'freightAmount', label: 'Freight', type: 'decimal', precision: 15, scale: 2, default: 0, section: 'Charges & bank' },
      { name: 'insuranceAmount', label: 'Insurance', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'discountAmount', label: 'Discount', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'bankAccountId', label: 'Bank account for remittance', type: 'ref', ref: 'bankAccounts', span: 2 },
      { name: 'showNotifyParty', label: 'Print notify party', type: 'boolean', default: true, section: 'Print options' },
      { name: 'showShippingDetails', label: 'Print shipping details', type: 'boolean', default: true },
      { name: 'showSpecification', label: 'Print specification', type: 'boolean', default: true },
      { name: 'showLcDetails', label: 'Print LC details', type: 'boolean', default: true },
      { name: 'showBankDetails', label: 'Print bank details', type: 'boolean', default: true },
      { name: 'showTermsConditions', label: 'Print terms & conditions', type: 'boolean', default: true },
      { name: 'showSignatureBlock', label: 'Print signature & stamp', type: 'boolean', default: true },
    ],
    lines: [...productLine(true), ...lineExtras],
    totals: [
      { name: 'totalQuantityMt', label: 'Total quantity (MT)', scale: 3 },
      { name: 'totalBags', label: 'Total bags', scale: 0 },
      { name: 'goodsAmount', label: 'Goods value', scale: 2 },
      { name: 'gstAmount', label: 'GST', scale: 2 },
      { name: 'grandTotal', label: 'Grand total', scale: 2 },
    ],
  },
  {
    key: 'productionOrders',
    label: 'Production order',
    plural: 'Production orders',
    short: 'Production order',
    table: 'production_orders',
    linesTable: 'production_order_lines',
    termsTable: 'production_order_terms',
    module: 'sales.productionOrders',
    numbering: 'production_order',
    tcDocType: 'Production Order',
    statuses: ['OPEN', 'IN_PRODUCTION', 'COMPLETED', CANCELLED],
    defaultStatus: 'OPEN',
    parent: { doc: 'proformaInvoices', field: 'proformaInvoiceId' },
    header: [
      docNumber('Production order no.'),
      docDate,
      status(['OPEN', 'IN_PRODUCTION', 'COMPLETED', CANCELLED], 'OPEN'),
      { name: 'proformaInvoiceId', label: 'Generated against PI', type: 'doc', ref: 'proformaInvoices', list: true },
      { name: 'supplierId', label: 'Mill / supplier', type: 'ref', ref: 'suppliers', list: true },
      { name: 'dispatchSchedule', label: 'Dispatch by', type: 'date' },
      ...parties(false),
      ...buyerRefs,
      ...commercial,
      { name: 'freightAmount', label: 'Freight', type: 'decimal', precision: 15, scale: 2, default: 0 },
      { name: 'insuranceAmount', label: 'Insurance', type: 'decimal', precision: 15, scale: 2, default: 0 },
      ...shippingRoute,
      { name: 'preCarriageBy', label: 'Pre-carriage by', type: 'text', maxLength: 128 },
      { name: 'placeOfReceipt', label: 'Place of receipt', type: 'text', maxLength: 128 },
      { name: 'vesselFlightNo', label: 'Vessel / flight no.', type: 'text', maxLength: 128 },
      { name: 'termsOf', label: 'Terms of delivery', type: 'text', maxLength: 128 },
      { name: 'fcl', label: 'Containers (FCL)', type: 'text', maxLength: 32, help: 'e.g. 5 × 20FT' },
      { name: 'brand', label: 'Brand', type: 'text', maxLength: 128, section: 'Production' },
      { name: 'transport', label: 'Transport', type: 'text', maxLength: 128 },
      { name: 'vehicleNo', label: 'Vehicle no.', type: 'text', upper: true, maxLength: 64 },
      { name: 'millingInstructions', label: 'Milling instructions', type: 'textarea', span: 3 },
      { name: 'packagingInstructions', label: 'Packaging instructions', type: 'textarea', span: 3 },
      { name: 'orderRemark', label: 'Remarks', type: 'textarea', span: 3 },
      ...spec,
      { name: 'showSignature', label: 'Print signature & stamp', type: 'boolean', default: true, section: 'Print options' },
    ],
    lines: [...productLine(false), ...productionFlags, ...lineExtras],
    totals: [
      { name: 'totalQuantityMt', label: 'Total quantity (MT)', scale: 3 },
      { name: 'totalBags', label: 'Total bags', scale: 0 },
      { name: 'totalGrossWtMt', label: 'Total gross weight (MT)', scale: 3 },
      { name: 'goodsAmount', label: 'Goods value', scale: 2 },
      { name: 'gstAmount', label: 'GST', scale: 2 },
    ],
  },
  {
    key: 'commercialInvoices',
    label: 'Commercial invoice',
    plural: 'Commercial invoices',
    short: 'Invoice',
    table: 'commercial_invoices',
    linesTable: 'commercial_invoice_lines',
    termsTable: 'commercial_invoice_terms',
    module: 'sales.commercialInvoices',
    numbering: 'commercial_invoice',
    tcDocType: 'Commercial Invoice',
    statuses: ['ISSUED', 'NEGOTIATED', 'PAID', CANCELLED],
    defaultStatus: 'ISSUED',
    parent: { doc: 'productionOrders', field: 'productionOrderId' },
    containers: true,
    header: [
      docNumber('Commercial invoice no.'),
      docDate,
      { name: 'invoiceStage', label: 'Invoice stage', type: 'select', options: ['DRAFT', 'FINAL'], default: 'DRAFT', list: true, help: 'Draft prints a "DRAFT" mark; set to Final when the invoice is final' },
      status(['ISSUED', 'NEGOTIATED', 'PAID', CANCELLED], 'ISSUED'),
      { name: 'invoiceType', label: 'Invoice type', type: 'select', options: ['WHITE', 'CUSTOM'], default: 'WHITE', list: true },
      { name: 'productionOrderId', label: 'Generated against production order', type: 'doc', ref: 'productionOrders', list: true, help: 'Leave blank to continue without an order' },
      { name: 'orderRefText', label: 'Custom order reference', type: 'text', maxLength: 128, help: 'Use when the order is not in the system; printed in place of the linked order' },
      { name: 'proformaInvoiceId', label: 'Proforma invoice', type: 'doc', ref: 'proformaInvoices', help: 'Leave blank to continue without a PI' },
      { name: 'piRefText', label: 'Custom PI reference', type: 'text', maxLength: 128, help: 'Use when the PI is not in the system; printed in place of the linked PI' },
      ...parties(true),
      { name: 'buyerPoRef', label: "Buyer's PO / reference", type: 'text', maxLength: 128, search: true, section: 'References' },
      { name: 'poDate', label: 'PO date', type: 'date' },
      { name: 'includeLc', label: 'Include LC details', type: 'boolean', default: true, controls: ['lcNumber', 'lcDate'] },
      { name: 'lcNumber', label: 'LC no.', type: 'text', upper: true, maxLength: 64, search: true },
      { name: 'lcDate', label: 'LC date', type: 'date' },
      ...commercial,
      { name: 'lutNumber', label: 'LUT / bond no.', type: 'text', upper: true, maxLength: 64, hidden: true },
      ...shippingRoute.map((f) => (f.name === 'finalDestination' ? { ...f, hidden: true } : f)),
      { name: 'preCarriageBy', label: 'Pre-carriage by', type: 'text', maxLength: 128 },
      { name: 'containerTypeId', label: 'Container type (said to contain)', type: 'ref', ref: 'containerTypes', allowCreate: true, help: 'Printed as "<no. of containers> X <type> SAID TO CONTAIN"' },
      { name: 'noOfContainers', label: 'No. of containers', type: 'integer', help: "Auto-filled from each packing's container load and net weight — change it if the count should differ" },
      { name: 'saidToContain', label: 'Said to contain (override)', type: 'text', maxLength: 128, span: 2, help: 'Leave blank to build it from the container type and the number of containers' },
      {
        name: 'includeVessel',
        label: 'Include vessel & shipping bill',
        type: 'boolean',
        default: true,
        section: 'Vessel & shipping bill',
        controls: ['shippingLineId', 'vesselFlightName', 'voyageNumber', 'placeOfReceipt', 'termsOf', 'blNumber', 'blDate', 'shippingBillNumber', 'shippingBillDate', 'fcl'],
      },
      { name: 'shippingLineId', label: 'Shipping line', type: 'ref', ref: 'shippingLines' },
      { name: 'vesselFlightName', label: 'Vessel / flight', type: 'text', maxLength: 128 },
      { name: 'voyageNumber', label: 'Voyage no.', type: 'text', upper: true, maxLength: 64 },
      { name: 'placeOfReceipt', label: 'Place of receipt', type: 'text', maxLength: 128 },
      { name: 'termsOf', label: 'Terms of delivery', type: 'text', maxLength: 128 },
      { name: 'blNumber', label: 'Bill of lading no.', type: 'text', upper: true, maxLength: 64, search: true },
      { name: 'blDate', label: 'B/L date', type: 'date' },
      { name: 'shippingBillNumber', label: 'Shipping bill no.', type: 'text', upper: true, maxLength: 64, search: true },
      { name: 'shippingBillDate', label: 'Shipping bill date', type: 'date' },
      { name: 'fcl', label: 'Containers (FCL)', type: 'text', maxLength: 32, help: 'e.g. 5 × 20FT' },
      { name: 'brand', label: 'Brand', type: 'text', maxLength: 128, section: 'Goods', hidden: true },
      { name: 'marksNumbers', label: 'Marks & numbers', type: 'textarea', hidden: true },
      { name: 'goodsDescription', label: 'Goods description (printed above the lines)', type: 'textarea', span: 2, hidden: true },
      {
        name: 'includeShippingCharges',
        label: 'Include shipping charges',
        type: 'boolean',
        default: true,
        section: 'Shipping charges (by incoterm)',
        controls: ['thcCharge', 'blCharge', 'sealCharge', 'mucCharge', 'riskCharge', 'repositionCharge', 'oceanFreightCharge', 'insuranceCharge'],
      },
      { name: 'thcCharge', label: 'THC', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'blCharge', label: 'BL charges', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'sealCharge', label: 'Seal charges', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'mucCharge', label: 'MUC', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'riskCharge', label: 'Risk charges', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'repositionCharge', label: 'Reposition charges', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'oceanFreightCharge', label: 'Ocean freight (CFR / CIF)', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'insuranceCharge', label: 'Insurance (CIF)', type: 'decimal', precision: 12, scale: 2, default: 0 },
      { name: 'bankAccountId', label: 'Bank account for remittance', type: 'ref', ref: 'bankAccounts', span: 2, section: 'Bank & print' },
      { name: 'showSignature', label: 'Print signature & stamp', type: 'boolean', default: true },
    ],
    lines: [...productLine(true), ...productionFlags, ...lineExtras],
    totals: [
      { name: 'totalQuantityMt', label: 'Total net weight (MT)', scale: 3 },
      { name: 'totalBags', label: 'Total bags', scale: 0 },
      { name: 'totalGrossWtMt', label: 'Total gross weight (MT)', scale: 3 },
      { name: 'fobAmount', label: 'FOB value', scale: 2 },
      { name: 'gstAmount', label: 'GST', scale: 2 },
      { name: 'oceanFreightAmount', label: 'Ocean freight', scale: 2 },
      { name: 'insuranceAmount', label: 'Insurance', scale: 2 },
      { name: 'totalShippingCharge', label: 'Shipping charges (all)', scale: 2 },
      { name: 'invoiceTotal', label: 'Invoice total', scale: 2 },
    ],
  },
  // -------------------------------------------------------------- Ocean bill of lading (shipment details)
  // Header-only record created against a commercial invoice; the single source of vessel / BL / agent
  // data that every certificate reads from.
  {
    key: 'oceanBills',
    label: 'Ocean bill of lading',
    plural: 'Ocean bills of lading',
    short: 'OBL',
    table: 'ocean_bills',
    module: 'sales.oceanBills',
    numbering: 'ocean_bill',
    statuses: ['DRAFT', 'ISSUED', CANCELLED],
    defaultStatus: 'DRAFT',
    parent: { doc: 'commercialInvoices', field: 'commercialInvoiceId' },
    letter: true,
    header: [
      docNumber('OBL reference'),
      docDate,
      status(['DRAFT', 'ISSUED', CANCELLED], 'DRAFT'),
      { name: 'commercialInvoiceId', label: 'Against commercial invoice', type: 'doc', ref: 'commercialInvoices', required: true, list: true, help: 'Buyer, LC, ports and cargo are copied from this invoice' },
      ...parties(true),
      { name: 'blNumber', label: 'Bill of lading no.', type: 'text', upper: true, maxLength: 64, list: true, search: true, section: 'Bill of lading' },
      { name: 'blDate', label: 'B/L date', type: 'date', list: true },
      { name: 'shippingBillNumber', label: 'Shipping bill no.', type: 'text', upper: true, maxLength: 64, search: true },
      { name: 'shippingBillDate', label: 'Shipping bill date', type: 'date' },
      { name: 'vesselName', label: 'Vessel / flight', type: 'text', maxLength: 128, section: 'Vessel & route' },
      { name: 'voyageNo', label: 'Voyage no.', type: 'text', upper: true, maxLength: 64 },
      { name: 'shippingLineId', label: 'Shipping line', type: 'ref', ref: 'shippingLines', allowCreate: true },
      { name: 'portOfLoadingId', label: 'Port of loading', type: 'ref', ref: 'ports' },
      { name: 'portOfDischargeId', label: 'Port of discharge', type: 'ref', ref: 'ports' },
      { name: 'placeOfReceipt', label: 'Place of receipt', type: 'text', maxLength: 128 },
      { name: 'placeOfDelivery', label: 'Place of delivery', type: 'text', maxLength: 128 },
      { name: 'finalDestination', label: 'Final destination', type: 'text', maxLength: 128 },
      { name: 'destinationAgentId', label: 'Agent at destination', type: 'ref', ref: 'serviceProviders', allowCreate: true, section: 'Agent & applicant' },
      { name: 'destinationAgentAddress', label: "Agent's address", type: 'textarea', span: 2 },
      { name: 'lcNumber', label: 'LC no.', type: 'text', upper: true, maxLength: 64 },
      { name: 'lcDate', label: 'LC date', type: 'date' },
      { name: 'lcApplicantEmails', label: 'LC applicant email(s)', type: 'textarea', span: 2, help: 'Buyer email(s) the certificates must be sent to' },
      { name: 'shippingMarks', label: 'Shipping marks', type: 'textarea', span: 2, section: 'Cargo summary' },
      { name: 'goodsDescription', label: 'Description of goods', type: 'textarea', span: 2 },
      { name: 'packing', label: 'Packing', type: 'textarea', span: 2 },
      { name: 'brand', label: 'Brand', type: 'text', maxLength: 128 },
      { name: 'cropYear', label: 'Crop year', type: 'text', maxLength: 16 },
      { name: 'yearOfProduction', label: 'Year of production', type: 'text', maxLength: 16 },
      { name: 'netWeightMt', label: 'Net weight (MT)', type: 'decimal', precision: 12, scale: 3 },
      { name: 'grossWeightMt', label: 'Gross weight (MT)', type: 'decimal', precision: 12, scale: 3 },
      { name: 'totalBags', label: 'Total bags', type: 'integer' },
      { name: 'noOfContainers', label: 'No. of containers', type: 'integer' },
      { name: 'invoiceValue', label: 'Invoice value (printed)', type: 'text', maxLength: 64, help: 'e.g. USD 4,97,398.00' },
    ],
    lines: [],
    totals: [],
  },
  // -------------------------------------------------------------- Certificates (template-driven letters)
  {
    key: 'certificates',
    label: 'Certificate',
    plural: 'Certificates',
    short: 'Certificate',
    table: 'certificates',
    module: 'sales.certificates',
    numbering: 'certificate',
    statuses: ['ISSUED', CANCELLED],
    defaultStatus: 'ISSUED',
    parent: { doc: 'commercialInvoices', field: 'commercialInvoiceId' },
    letter: true,
    header: [
      docNumber('Certificate no.'),
      docDate,
      status(['ISSUED', CANCELLED], 'ISSUED'),
      { name: 'commercialInvoiceId', label: 'Against commercial invoice', type: 'doc', ref: 'commercialInvoices', required: true, list: true },
      { name: 'oceanBillId', label: 'Ocean bill of lading', type: 'doc', ref: 'oceanBills', list: true, help: 'Vessel / BL / agent details are read from this OBL' },
      { name: 'certificateTemplateId', label: 'Certificate template', type: 'ref', ref: 'certificateTemplates', required: true, allowCreate: true, list: true, span: 2 },
      { name: 'letterheadId', label: 'Letterhead', type: 'ref', ref: 'letterheads', allowCreate: true, help: 'Printed at the top (company logo is not used on certificates)' },
      { name: 'signatureId', label: 'Signature', type: 'ref', ref: 'signatures', allowCreate: true, help: 'Signature block at the bottom' },
      ...parties(true),
      { name: 'remark', label: 'Remark (printed under the body)', type: 'textarea', span: 2 },
    ],
    lines: [],
    totals: [],
  },
];

export const DOCS: Record<DocKey, DocDef> = Object.fromEntries(DOC_LIST.map((d) => [d.key, d])) as Record<DocKey, DocDef>;

export function getDoc(key: string): DocDef | undefined {
  return Object.prototype.hasOwnProperty.call(DOCS, key) ? DOCS[key as DocKey] : undefined;
}

/** Child documents generated against this one (e.g. production orders of a PI). */
export const childDocs = (key: DocKey) => DOC_LIST.filter((d) => d.parent?.doc === key);

export const CONTAINER_FIELDS: FieldDef[] = [
  { name: 'containerNumber', label: 'Container no.', type: 'text', upper: true, required: true, maxLength: 32 },
  { name: 'sealNumber', label: 'Seal no.', type: 'text', upper: true, required: true, maxLength: 32 },
  { name: 'containerSize', label: 'Size', type: 'select', options: ['20FT', '40FT', '40HC'], required: true, default: '20FT' },
  { name: 'totalBags', label: 'Bags', type: 'integer', required: true },
  { name: 'netWeightKg', label: 'Net weight (kg)', type: 'decimal', precision: 12, scale: 3, required: true },
  { name: 'grossWeightKg', label: 'Gross weight (kg)', type: 'decimal', precision: 12, scale: 3, required: true },
];

export const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Fill a certificate template's body by replacing {{placeholder}} tokens with values from `ctx`.
 * Plain string substitution only — template text is never evaluated as code. Unknown or empty
 * values print as "____" so a missing figure is obvious on the certificate.
 */
export function fillTemplate(body: string, ctx: Record<string, unknown>): string {
  return String(body ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const v = ctx[key.toLowerCase()];
    return v === null || v === undefined || v === '' ? '____' : String(v);
  });
}

/** Placeholders a certificate template may use, shown as help on the template editor. */
export const CERTIFICATE_PLACEHOLDERS = [
  'exporter', 'consignee', 'applicant', 'buyer', 'notify',
  'invoice_no', 'invoice_date', 'bl_no', 'bl_date', 'shipping_bill_no', 'shipping_bill_date',
  'vessel', 'voyage', 'shipping_line', 'port_loading', 'port_discharge', 'place_receipt', 'place_delivery', 'final_destination',
  'destination_agent', 'destination_agent_address',
  'net_weight', 'gross_weight', 'total_bags', 'no_of_containers',
  'lc_no', 'lc_date', 'lc_applicant_emails', 'po_no', 'po_date',
  'brand', 'description', 'packing', 'shipping_marks', 'crop_year', 'year_of_production', 'invoice_value',
] as const;

/**
 * Number of 20ft containers for the "SAID TO CONTAIN" line, from each packing's net weight
 * and its per-container capacity (set on the packing master). Sums fractional containers across
 * packings and rounds up. Returns 0 when no line has a capacity (then the count is unknown).
 */
export function containerCount(lines: Record<string, unknown>[]): number {
  let sum = 0;
  let any = false;
  for (const l of lines) {
    const cap = Number(l.containerCapacityMt);
    const qty = Number(l.quantityMt);
    if (cap > 0 && qty > 0) {
      sum += qty / cap;
      any = true;
    }
  }
  return any ? Math.ceil(sum - 1e-6) : 0;
}

// ------------------------------------------------------------------ totals
type Values = Record<string, unknown>;
const v = (x: unknown): DecimalInput => (x === null || x === undefined || x === '' ? '0' : (x as string));

/** Amount of one line: net weight × rate, rounded half-up to 2 decimals. */
export const lineAmount = (line: Values) => mul(v(line.quantityMt), v(line.ratePerMt), 2);

/**
 * Authoritative document totals (exact decimals). Returns every TotalDef of the document.
 * Commercial invoices also return the incoterm-adjusted charge fields.
 */
export function computeTotals(def: DocDef, header: Values, lines: Values[]): Record<string, string> {
  if (!def.totals.length) return {}; // header-only letter documents (OBL, certificates)
  const amounts = lines.map(lineAmount);
  const totalQuantityMt = add(lines.map((l) => v(l.quantityMt)), 3);
  const totalBags = add(lines.map((l) => v(l.noOfBags)), 0);
  const totalGrossWtMt = add(lines.map((l) => v(l.grossWtMt)), 3);
  const goods = add(amounts, 2);
  const gstAmount = add(lines.flatMap((l) => [v(l.cgst), v(l.sgst), v(l.igst)]), 2);

  if (def.key === 'proformaInvoices') {
    const grandTotal = sub(add([goods, v(header.freightAmount), v(header.insuranceAmount)], 2), v(header.discountAmount), 2);
    return { totalQuantityMt, totalBags, goodsAmount: goods, gstAmount, grandTotal };
  }
  if (def.key === 'productionOrders') {
    return { totalQuantityMt, totalBags, totalGrossWtMt, goodsAmount: goods, gstAmount };
  }
  // When the shipping-charges section is switched off, no charge counts.
  const chargeInput = header.includeShippingCharges === false ? {} : (header as Record<string, DecimalInput>);
  const charges = computeShippingCharges(String(header.incoterm ?? 'FOB'), chargeInput);
  return {
    ...charges,
    totalQuantityMt,
    totalBags,
    totalGrossWtMt,
    fobAmount: goods,
    gstAmount,
    oceanFreightAmount: charges.oceanFreightCharge,
    insuranceAmount: charges.insuranceCharge,
    invoiceTotal: add([goods, charges.oceanFreightCharge, charges.insuranceCharge], 2),
  };
}

/** The amount printed in words / used in reports for a document. */
export const documentValue = (def: DocDef, totals: Record<string, unknown>) =>
  round(v(def.key === 'proformaInvoices' ? totals.grandTotal : def.key === 'commercialInvoices' ? totals.invoiceTotal : totals.goodsAmount), 2);

/** Fields of the parent document copied into a new child document (same name on both). */
export function inheritedFields(child: DocDef): string[] {
  if (!child.parent) return [];
  const parent = DOCS[child.parent.doc];
  const skip = new Set(['documentNumber', 'documentDate', 'status', child.parent.field]);
  const names = new Set(parent.header.map((f) => f.name));
  return child.header.filter((f) => names.has(f.name) && !skip.has(f.name)).map((f) => f.name);
}

/** PI fields that can be grouped in the "field usage" report. */
export const PI_REPORT_FIELDS = [
  { name: 'incoterm', label: 'Incoterm' },
  { name: 'currencyId', label: 'Currency' },
  { name: 'paymentTermId', label: 'Payment term' },
  { name: 'buyerId', label: 'Buyer' },
  { name: 'portOfLoadingId', label: 'Port of loading' },
  { name: 'portOfDischargeId', label: 'Port of discharge' },
  { name: 'destinationCountryId', label: 'Destination country' },
  { name: 'brand', label: 'Brand' },
  { name: 'status', label: 'Status' },
  { name: 'specCropYear', label: 'Crop year' },
] as const;
