export interface LineDraft {
  id: string;
  productId: string;
  productName: string;
  packingTypeId: string;
  packingName: string;
  packingText: string;
  hsCode: string;
  cropYear: string;
  quantityMt: number;
  ratePerMt: number;
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  brokenPct?: number;
}

export interface SectionToggles {
  showNotifyParty: boolean;
  showShippingDetails: boolean;
  showSpecification: boolean;
  showBankDetails: boolean;
  showLcDetails: boolean;
  showTermsConditions: boolean;
  showSignatureBlock: boolean;
}

export const DEFAULT_SECTIONS: SectionToggles = {
  showNotifyParty: true,
  showShippingDetails: true,
  showSpecification: true,
  showBankDetails: true,
  showLcDetails: true,
  showTermsConditions: true,
  showSignatureBlock: true,
};
