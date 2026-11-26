import type { PurchaseCategory } from '@rmm/shared';
import type { PurchaseInvoiceRow } from '../../components/PurchaseForms';

export type NextStepKey = 'LINES' | 'PLAN' | 'PACKAGING' | 'ORDER_PACKAGING' | 'SHIP' | 'DOCUMENTS' | 'PAYMENT' | 'DONE' | 'CANCELLED';

/** What to do next on an order: the label, its colour and the order-file tab where it is done. */
export const NEXT_STEP: Record<NextStepKey, { label: string; tone: 'slate' | 'amber' | 'red' | 'green' | 'blue'; tab: string; help: string }> = {
  LINES: { label: 'Add order lines', tone: 'red', tab: 'lots', help: 'The order has no quantities yet. Edit the order and add its lines.' },
  PLAN: { label: 'Plan the lots', tone: 'amber', tab: 'plan', help: 'Split the order into shipment lots (automatic plan, preview first).' },
  PACKAGING: { label: 'Work out packaging', tone: 'amber', tab: 'plan', help: 'Calculate the bags, tags and seals to buy for the planned lots.' },
  ORDER_PACKAGING: { label: 'Order the packaging', tone: 'amber', tab: 'plan', help: 'Choose suppliers and rates, then create the purchase orders.' },
  SHIP: { label: 'Ship the lots', tone: 'blue', tab: 'lots', help: 'Add booking, shipping bill and BL as they arrive (upload them into the lot).' },
  DOCUMENTS: { label: 'Collect documents', tone: 'blue', tab: 'documents', help: 'Upload the missing documents into each lot folder.' },
  PAYMENT: { label: 'Follow up payment', tone: 'blue', tab: 'money', help: 'Record the receipts against the commercial invoices.' },
  DONE: { label: 'Complete', tone: 'green', tab: 'lots', help: 'Everything is shipped, documented and paid.' },
  CANCELLED: { label: 'Cancelled', tone: 'slate', tab: 'lots', help: 'This order is cancelled.' },
};

export interface Progress {
  next: NextStepKey;
  lots: number;
  shipped: number;
  plannedMt: number;
  containers: number;
  nextShipDate: string | null;
  docsDone: number;
  docsNeeded: number;
  packagingToOrder: number;
  packagingLines: number;
  toReview: number;
  invoiced: number;
  received: number;
  alerts: string[];
}

export interface OrderRow {
  id: string;
  number: string;
  date: string;
  status: string;
  orderSource: string;
  buyer: string | null;
  buyerPoRef: string | null;
  lcNumber: string | null;
  totalMt: string;
  amount: string;
  currency: string | null;
  progress: Progress;
}

export interface FileRef {
  id: string;
  fileId: string;
  fileName: string;
  kind: string | null;
  label: string;
  status: string;
  shipmentId: string | null;
  createdAt: string;
}

export interface MadeDoc {
  key: string;
  label: string;
  id: string;
  number: string;
  date: string;
  status: string;
  shipmentId: string | null;
}

export interface CheckItem {
  kind: string;
  label: string;
  required: boolean;
  status: 'PENDING' | 'RECEIVED' | 'NOT_NEEDED';
  fileId: string | null;
  refNo: string | null;
  docDate: string | null;
}

export interface OrderLot {
  id: string;
  lotNo: number;
  market: string;
  status: string;
  period: string | null;
  quantityMt: string;
  containerCount: number;
  targetShipDate: string | null;
  shippingLine: string | null;
  bookingNo: string | null;
  vessel: string | null;
  eta: string | null;
  invoiceNumber: string | null;
  blNumber: string | null;
  blStatus: string;
  sbNumber: string | null;
  lines: { id: string; label: string; portName: string | null; quantityMt: string; bags: number; containers: number }[];
  checklist: CheckItem[];
  files: FileRef[];
  documents: MadeDoc[];
}

export interface OrderFile {
  order: Omit<OrderRow, 'progress'>;
  progress: Progress;
  lots: OrderLot[];
  folders: { toReview: FileRef[]; orderPapers: FileRef[]; documents: MadeDoc[] };
  vendorPos: { id: string; number: string; poDate: string; status: string; category: PurchaseCategory; totalAmount: string; billedAmount: string; items: number; supplierName: string | null }[];
  purchaseInvoices: PurchaseInvoiceRow[];
  freight: { id: string; number: string; status: string; date: string; portOfLoading: string; portOfDischarge: string; containerCount: number; shipmentId: string | null; awardedTo: string | null }[];
  payments: { id: string; date: string; amount: string; mode: string | null; reference: string | null }[];
}
