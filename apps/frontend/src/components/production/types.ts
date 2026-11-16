export interface ProdLineDraft {
  id: string;
  productId: string;
  productName: string;
  packingTypeId: string;
  packingText: string;
  hsCode: string;
  cropYear: string;
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
