/**
 * Master-data registry.
 *
 * One definition drives three things:
 *   1. the PostgreSQL table (apps/api/src/db/schema/masters.ts builds Drizzle tables from it)
 *   2. API validation (buildEntitySchema below)
 *   3. the list + form screens in the web app
 *
 * To add a new master: add an EntityDef here, run `pnpm db:generate && pnpm db:migrate`.
 * Permissions (`master.<key>`), RLS policies and UI menu entries are derived automatically.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'select'
  | 'ref'
  | 'date'
  | 'email'
  | 'file';

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Unique within the owning company (or globally for global masters). Ignores soft-deleted rows. */
  unique?: boolean;
  /** Force upper-case (codes, GSTIN, IEC...). */
  upper?: boolean;
  maxLength?: number;
  options?: readonly string[];
  /** For type 'ref': the referenced entity key (checked at startup by assertRegistry). */
  ref?: string;
  /** Shown as a column in list screens. */
  list?: boolean;
  /** Included in the quick search. */
  search?: boolean;
  /** Form section heading. */
  section?: string;
  /** Grid columns the input spans in the form (1–3). */
  span?: 1 | 2 | 3;
  /** Default value for new records when the company has not configured one. */
  default?: string | number | boolean;
  help?: string;
  /** decimal precision/scale */
  precision?: number;
  scale?: number;
}

/**
 * global  – one list for the whole group (currencies, ports...). No company_id.
 * company – owned by a company, isolated by Row Level Security.
 * group   – the companies table itself.
 */
export type EntityScope = 'global' | 'company' | 'group';

export interface EntityDef {
  key: string;
  table: string;
  label: string;
  plural: string;
  menu: 'Company' | 'Parties' | 'Products' | 'Logistics' | 'Finance' | 'General';
  scope: EntityScope;
  /** Company masters only: may be shared with other companies through sharing policies. */
  shareable?: boolean;
  displayField: string;
  fields: FieldDef[];
}

const active: FieldDef = { name: 'isActive', label: 'Active', type: 'boolean', default: true, list: true };

const PRODUCT_TYPES = ['Raw', 'Steam', 'Parboiled', 'Sella', 'Golden Sella', 'White Sella', 'Creamy Sella'] as const;

export const ENTITY_LIST = [
  // ---------------------------------------------------------------- Company (group scope)
  {
    key: 'companies',
    table: 'companies',
    label: 'Company',
    plural: 'Companies',
    menu: 'Company',
    scope: 'group',
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Short code', type: 'text', required: true, unique: true, upper: true, maxLength: 12, list: true, search: true, section: 'Identity', help: 'Used in document numbers, e.g. RMM/EX/26-27/001' },
      { name: 'name', label: 'Display name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'legalName', label: 'Legal name (as on documents)', type: 'text', required: true, span: 3 },
      { name: 'addressLine1', label: 'Address line 1', type: 'text', span: 3, section: 'Address' },
      { name: 'addressLine2', label: 'Address line 2', type: 'text', span: 3 },
      { name: 'city', label: 'City', type: 'text', list: true },
      { name: 'state', label: 'State', type: 'text' },
      { name: 'pincode', label: 'PIN code', type: 'text', maxLength: 10 },
      { name: 'countryId', label: 'Country', type: 'ref', ref: 'countries' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'website', label: 'Website', type: 'text' },
      { name: 'gstin', label: 'GSTIN', type: 'text', upper: true, maxLength: 15, list: true, section: 'Registrations' },
      { name: 'iec', label: 'IEC', type: 'text', upper: true, maxLength: 10, list: true },
      { name: 'pan', label: 'PAN', type: 'text', upper: true, maxLength: 10 },
      { name: 'apedaRegNo', label: 'APEDA RCMC no.', type: 'text', upper: true },
      { name: 'apedaValidTill', label: 'APEDA valid till', type: 'date' },
      { name: 'fssaiNo', label: 'FSSAI licence no.', type: 'text' },
      { name: 'lutNo', label: 'LUT / Bond no.', type: 'text', upper: true },
      { name: 'lutValidTill', label: 'LUT valid till', type: 'date' },
      { name: 'cin', label: 'CIN', type: 'text', upper: true },
      { name: 'baseCurrencyId', label: 'Base currency', type: 'ref', ref: 'currencies', section: 'Defaults' },
      { name: 'fyStartMonth', label: 'Financial year starts (month 1-12)', type: 'integer', default: 4 },
      { name: 'signatoryName', label: 'Authorised signatory', type: 'text', section: 'Signatory & branding' },
      { name: 'signatoryDesignation', label: 'Designation', type: 'text' },
      { name: 'logoFileId', label: 'Logo', type: 'file' },
      { name: 'letterheadFileId', label: 'Letterhead (header image)', type: 'file' },
      { name: 'footerFileId', label: 'Letterhead footer image', type: 'file' },
      { name: 'sealFileId', label: 'Company seal / stamp', type: 'file' },
      { name: 'signatureFileId', label: 'Signature', type: 'file' },
      active,
    ],
  },
  {
    key: 'bankAccounts',
    table: 'bank_accounts',
    label: 'Bank account',
    plural: 'Bank accounts',
    menu: 'Company',
    scope: 'company',
    displayField: 'label',
    fields: [
      { name: 'label', label: 'Short label', type: 'text', required: true, list: true, search: true, help: 'e.g. "HDFC USD"' },
      { name: 'bankName', label: 'Bank name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'branch', label: 'Branch', type: 'text' },
      { name: 'accountName', label: 'Account name', type: 'text', span: 2 },
      { name: 'accountNumber', label: 'Account no.', type: 'text', required: true, list: true },
      { name: 'ifsc', label: 'IFSC', type: 'text', upper: true, maxLength: 11 },
      { name: 'swiftCode', label: 'SWIFT', type: 'text', upper: true, maxLength: 11, list: true },
      { name: 'adCode', label: 'AD code', type: 'text' },
      { name: 'iban', label: 'IBAN', type: 'text', upper: true },
      { name: 'currencyId', label: 'Currency', type: 'ref', ref: 'currencies', list: true },
      { name: 'bankAddress', label: 'Bank address', type: 'textarea', span: 3 },
      { name: 'intermediaryBank', label: 'Intermediary / correspondent bank', type: 'textarea', span: 3 },
      { name: 'isDefault', label: 'Default account', type: 'boolean', default: false, list: true },
      active,
    ],
  },

  // ---------------------------------------------------------------- Parties
  {
    key: 'customers',
    table: 'customers',
    label: 'Customer / Buyer',
    plural: 'Customers / Buyers',
    menu: 'Parties',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'contactPerson', label: 'Contact person', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'address', label: 'Address', type: 'textarea', span: 3 },
      { name: 'city', label: 'City', type: 'text', list: true },
      { name: 'countryId', label: 'Country', type: 'ref', ref: 'countries', list: true },
      { name: 'taxId', label: 'Tax / VAT / Import licence', type: 'text' },
      { name: 'defaultCurrencyId', label: 'Default currency', type: 'ref', ref: 'currencies', section: 'Defaults' },
      { name: 'paymentTermId', label: 'Default payment term', type: 'ref', ref: 'paymentTerms' },
      { name: 'defaultPortId', label: 'Default port of discharge', type: 'ref', ref: 'ports' },
      { name: 'incoterm', label: 'Default incoterm', type: 'select', options: ['FOB', 'CFR', 'CIF', 'CNF', 'EXW', 'FCA', 'DAP'] },
      { name: 'consigneeDetails', label: 'Consignee (if different)', type: 'textarea', span: 3, section: 'Shipping parties' },
      { name: 'notifyParty', label: 'Notify party', type: 'textarea', span: 3 },
      { name: 'remarks', label: 'Remarks', type: 'textarea', span: 3 },
      active,
    ],
  },
  {
    key: 'suppliers',
    table: 'suppliers',
    label: 'Supplier / Miller',
    plural: 'Suppliers / Millers',
    menu: 'Parties',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'supplierType', label: 'Type', type: 'select', options: ['Miller', 'Trader', 'Packing material', 'Other'], default: 'Miller', list: true },
      { name: 'contactPerson', label: 'Contact person', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text', list: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Address', type: 'textarea', span: 3 },
      { name: 'city', label: 'City', type: 'text', list: true },
      { name: 'state', label: 'State', type: 'text' },
      { name: 'gstin', label: 'GSTIN', type: 'text', upper: true, maxLength: 15, list: true, search: true, section: 'Tax & bank' },
      { name: 'pan', label: 'PAN', type: 'text', upper: true, maxLength: 10 },
      { name: 'bankName', label: 'Bank name', type: 'text' },
      { name: 'accountNumber', label: 'Account no.', type: 'text' },
      { name: 'ifsc', label: 'IFSC', type: 'text', upper: true, maxLength: 11 },
      { name: 'remarks', label: 'Remarks', type: 'textarea', span: 3 },
      active,
    ],
  },
  {
    key: 'serviceProviders',
    table: 'service_providers',
    label: 'CHA / Forwarder',
    plural: 'CHA / Forwarders',
    menu: 'Parties',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'providerType', label: 'Type', type: 'select', required: true, options: ['CHA', 'Freight forwarder', 'CHA + Forwarder', 'Transporter', 'Surveyor', 'Fumigation agency', 'Insurance'], default: 'CHA', list: true },
      { name: 'licenseNo', label: 'Licence no.', type: 'text' },
      { name: 'contactPerson', label: 'Contact person', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text', list: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'gstin', label: 'GSTIN', type: 'text', upper: true, maxLength: 15 },
      { name: 'address', label: 'Address', type: 'textarea', span: 3 },
      active,
    ],
  },

  // ---------------------------------------------------------------- Products
  {
    key: 'products',
    table: 'products',
    label: 'Product',
    plural: 'Products (rice)',
    menu: 'Products',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2, help: 'e.g. 1121 Golden Sella Basmati' },
      { name: 'variety', label: 'Variety', type: 'select', options: ['Basmati', 'Non-Basmati'], default: 'Basmati', list: true },
      { name: 'riceType', label: 'Processing', type: 'select', options: PRODUCT_TYPES, list: true },
      { name: 'grade', label: 'Grade', type: 'text', search: true },
      { name: 'hsnCode', label: 'HS code', type: 'text', list: true, default: '10063020' },
      { name: 'defaultUnitId', label: 'Default unit', type: 'ref', ref: 'units' },
      { name: 'cropYear', label: 'Crop year', type: 'text' },
      { name: 'avgGrainLength', label: 'Avg. grain length (mm)', type: 'decimal', precision: 6, scale: 2, section: 'Specification' },
      { name: 'brokenPct', label: 'Broken % (max)', type: 'decimal', precision: 5, scale: 2 },
      { name: 'moisturePct', label: 'Moisture % (max)', type: 'decimal', precision: 5, scale: 2 },
      { name: 'invoiceDescription', label: 'Description on documents', type: 'textarea', span: 3 },
      active,
    ],
  },
  {
    key: 'packingTypes',
    table: 'packing_types',
    label: 'Packing type',
    plural: 'Packing types',
    menu: 'Products',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2, help: 'e.g. 40 KG Non-woven bag' },
      { name: 'material', label: 'Material', type: 'select', options: ['PP', 'BOPP', 'Jute', 'Non-woven', 'Cotton', 'Laminated', 'Other'], list: true },
      { name: 'netWeightKg', label: 'Net weight (kg)', type: 'decimal', precision: 10, scale: 3, required: true, list: true },
      { name: 'tareWeightKg', label: 'Tare / empty bag (kg)', type: 'decimal', precision: 10, scale: 3, default: 0 },
      { name: 'description', label: 'Description on documents', type: 'textarea', span: 3 },
      active,
    ],
  },
  {
    key: 'units',
    table: 'units',
    label: 'Unit',
    plural: 'Units',
    menu: 'Products',
    scope: 'global',
    displayField: 'code',
    fields: [
      { name: 'code', label: 'Code', type: 'text', required: true, unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true },
      { name: 'kgFactor', label: 'Kg per unit', type: 'decimal', precision: 14, scale: 4, list: true, help: 'MT = 1000, QTL = 100' },
      active,
    ],
  },

  // ---------------------------------------------------------------- Logistics (global)
  {
    key: 'countries',
    table: 'countries',
    label: 'Country',
    plural: 'Countries',
    menu: 'Logistics',
    scope: 'global',
    displayField: 'name',
    fields: [
      { name: 'code', label: 'ISO code', type: 'text', required: true, unique: true, upper: true, maxLength: 3, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true },
      { name: 'region', label: 'Region', type: 'text', list: true },
      active,
    ],
  },
  {
    key: 'ports',
    table: 'ports',
    label: 'Port',
    plural: 'Ports',
    menu: 'Logistics',
    scope: 'global',
    displayField: 'name',
    fields: [
      { name: 'code', label: 'UN/LOCODE', type: 'text', unique: true, upper: true, maxLength: 6, list: true, search: true },
      { name: 'name', label: 'Port name', type: 'text', required: true, list: true, search: true },
      { name: 'countryId', label: 'Country', type: 'ref', ref: 'countries', required: true, list: true },
      { name: 'portType', label: 'Type', type: 'select', options: ['Sea', 'ICD', 'Air', 'Land'], default: 'Sea', list: true },
      { name: 'isLoading', label: 'Used as port of loading', type: 'boolean', default: false, list: true },
      active,
    ],
  },
  {
    key: 'shippingLines',
    table: 'shipping_lines',
    label: 'Shipping line',
    plural: 'Shipping lines',
    menu: 'Logistics',
    scope: 'global',
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code / SCAC', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'contactPerson', label: 'Contact person', type: 'text' },
      { name: 'phone', label: 'Phone', type: 'text', list: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'website', label: 'Website / tracking URL', type: 'text', span: 2 },
      { name: 'address', label: 'Address', type: 'textarea', span: 3 },
      active,
    ],
  },

  // ---------------------------------------------------------------- Finance
  {
    key: 'currencies',
    table: 'currencies',
    label: 'Currency',
    plural: 'Currencies',
    menu: 'Finance',
    scope: 'global',
    displayField: 'code',
    fields: [
      { name: 'code', label: 'Code', type: 'text', required: true, unique: true, upper: true, maxLength: 3, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true },
      { name: 'symbol', label: 'Symbol', type: 'text', maxLength: 5, list: true },
      { name: 'exchangeRate', label: 'Default exchange rate (to INR)', type: 'decimal', precision: 14, scale: 4, default: 1, list: true },
      { name: 'decimals', label: 'Decimal places', type: 'integer', default: 2 },
      { name: 'subunitName', label: 'Sub-unit (for amount in words)', type: 'text', help: 'e.g. Cents, Paise' },
      active,
    ],
  },
  {
    key: 'paymentTerms',
    table: 'payment_terms',
    label: 'Payment term',
    plural: 'Payment terms',
    menu: 'Finance',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'code', label: 'Code', type: 'text', unique: true, upper: true, list: true, search: true },
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'termType', label: 'Type', type: 'select', required: true, options: ['Advance', 'LC at sight', 'LC usance', 'DP', 'DA', 'CAD', 'TT', 'Mixed'], list: true },
      { name: 'advancePct', label: 'Advance %', type: 'decimal', precision: 5, scale: 2, default: 0, list: true },
      { name: 'creditDays', label: 'Credit days', type: 'integer', default: 0, list: true },
      { name: 'printText', label: 'Text printed on documents', type: 'textarea', span: 3 },
      active,
    ],
  },
  {
    key: 'tcTemplates',
    table: 'tc_templates',
    label: 'T&C template',
    plural: 'T&C templates',
    menu: 'General',
    scope: 'company',
    shareable: true,
    displayField: 'name',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, list: true, search: true, span: 2 },
      { name: 'docType', label: 'Document type', type: 'select', required: true, options: ['Proforma Invoice', 'Sales Contract', 'Commercial Invoice', 'Purchase Order', 'General'], list: true },
      { name: 'body', label: 'Terms text (one per line)', type: 'textarea', required: true, span: 3 },
      { name: 'isDefault', label: 'Default for this document type', type: 'boolean', default: false, list: true },
      active,
    ],
  },
] as const satisfies readonly EntityDef[];

export type EntityKey = (typeof ENTITY_LIST)[number]['key'];

export const ENTITIES: Record<string, EntityDef> = Object.fromEntries(
  (ENTITY_LIST as readonly EntityDef[]).map((e) => [e.key, e]),
);

export function getEntity(key: string): EntityDef | undefined {
  return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : undefined;
}

/** Fails fast on typos in the registry (bad ref targets, missing display fields). */
export function assertRegistry() {
  for (const e of Object.values(ENTITIES)) {
    if (!e.fields.some((f) => f.name === e.displayField)) throw new Error(`${e.key}: displayField ${e.displayField} missing`);
    for (const f of e.fields) {
      if (f.type === 'ref' && (!f.ref || !ENTITIES[f.ref])) throw new Error(`${e.key}.${f.name}: unknown ref ${f.ref}`);
      if (f.type === 'select' && !f.options?.length) throw new Error(`${e.key}.${f.name}: select without options`);
    }
  }
}
assertRegistry();

export const MENU_ORDER: EntityDef['menu'][] = ['Company', 'Parties', 'Products', 'Logistics', 'Finance', 'General'];
