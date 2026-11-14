export interface CompanyHeaderData {
  name: string;
  code: string;
  address?: string;
  gstin?: string;
  iec?: string;
  phone?: string;
  email?: string;
}

export interface CustomerPartyData {
  name: string;
  address: string;
  country: string;
  taxId?: string;
}

export interface InvoiceLineItemPdf {
  productName: string;
  packingDescription: string;
  quantityMt: number;
  ratePerMt: number;
  amount: number;
  specifications?: string;
}

export interface ContainerPdfData {
  containerNumber: string;
  sealNumber: string;
  containerSize: string;
  totalBags: number;
  grossWeightKg: number;
  netWeightKg: number;
}

export interface ProformaItemPdf {
  lineNumber: number;
  productName: string;
  description?: string;
  packingText?: string;
  hsCode?: string;
  cropYear?: string;
  quantityMt: number;
  ratePerMt: number;
  amount: number;
}

export interface ProformaInvoicePdfData {
  company: CompanyHeaderData & {
    legalName?: string;
    addressLines?: string[];
  };
  documentNumber: string;
  documentDate: string;
  buyerPoRef?: string;
  poDate?: string;
  lcNumber?: string;
  lcDate?: string;
  currency: string;
  incoterm: string;
  paymentTerms: string;
  consignee?: CustomerPartyData;
  buyer?: CustomerPartyData;
  notifyParty?: CustomerPartyData;
  countryOfOrigin: string;
  portOfLoading: string;
  portOfDischarge: string;
  finalDestination: string;
  modeOfShipment: string;
  items: ProformaItemPdf[];
  totalQuantityMt: number;
  goodsSubtotal: number;
  freightAmount: number;
  insuranceAmount: number;
  discountAmount: number;
  grandTotal: number;
  amountInWords: string;
  bankDetails?: {
    accountName: string;
    bankName: string;
    accountNumber: string;
    swiftCode: string;
    ifscAdCode?: string;
  };
  terms: string[];
  sections: {
    showNotifyParty: boolean;
    showShippingDetails: boolean;
    showBankDetails: boolean;
    showLcDetails: boolean;
    showTermsConditions: boolean;
    showSignatureBlock: boolean;
  };
  footer?: {
    addressLine: string;
    contactLine: string;
  };
}

export interface ProductionOrderItemPdf {
  lineNumber: number;
  productName: string;
  packing: string;
  noOfBags: number;
  quantityMt: number;
  description?: string;
}

export interface ProductionOrderPdfData {
  company: CompanyHeaderData & { legalName?: string; addressLines?: string[] };
  documentNumber: string;
  documentDate: string;
  buyer?: CustomerPartyData;
  consignee?: CustomerPartyData;
  notifyParty?: CustomerPartyData;
  buyerPoRef?: string;
  poDate?: string;
  incoterm: string;
  currency: string;
  status: string;
  spec: {
    variety?: string;
    avgLength?: string;
    moisture?: string;
    broken?: string;
    cropYear?: string;
  };
  shipping: {
    portOfLoading?: string;
    portOfDischarge?: string;
    destinationCountry?: string;
    vesselFlightNo?: string;
    transport?: string;
    vehicleNo?: string;
    brand?: string;
  };
  items: ProductionOrderItemPdf[];
  totalQuantityMt: number;
  totalBags: number;
  instructions: string;
  terms: string[];
  showSignature: boolean;
  footer?: { line: string };
}

export interface CommercialInvoicePdfData {
  company: CompanyHeaderData;
  buyer: CustomerPartyData;
  consignee?: CustomerPartyData;
  documentNumber: string;
  documentDate: string;
  financialYear: string;
  buyerPoNumber?: string;
  portOfLoading: string;
  portOfDischarge: string;
  countryOfDestination: string;
  incoterm: string;
  currency: string;
  items: InvoiceLineItemPdf[];
  totalFobAmount: number;
  oceanFreightAmount: number;
  insuranceAmount: number;
  totalInvoiceAmount: number;
  amountInWords: string;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    swiftCode: string;
    branchName?: string;
  };
  containers?: ContainerPdfData[];
}
