export interface InvLineDraft {
  id: string;
  productId: string;
  productName: string;
  packingTypeId: string;
  packingText: string;
  hsCode: string;
  noOfBags: number;
  quantityMt: number; // net wt MT
  grossWtMt?: number;
  ratePerMt: number;
  amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  brokenBelow: boolean;
  fcl: boolean;
}

export interface InvContainerDraft {
  id: string;
  containerNumber: string;
  sealNumber: string;
  containerSize: string;
  totalBags: number;
  grossWeightKg: number;
  netWeightKg: number;
}
