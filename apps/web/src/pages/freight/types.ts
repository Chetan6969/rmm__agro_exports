export interface MailAccount {
  email: string;
  displayName: string | null;
  provider: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  username: string;
  status: 'ok' | 'error' | 'unverified';
  lastError: string | null;
  lastSyncAt: string | null;
}

export interface Provider {
  provider: string;
  label: string;
  domains: string[];
  passwordHelp: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
}

export interface MailboxInfo {
  ready: boolean;
  account: MailAccount | null;
  providers: Provider[];
  pollMinutes: number;
}

export interface EnquiryRow {
  id: string;
  number: string;
  enquiryDate: string;
  status: string;
  portOfLoading: string;
  portOfDischarge: string;
  containerType: string;
  containerCount: number;
  readyDate: string | null;
  replyBy: string | null;
  shipmentId: string | null;
  sent: number;
  replied: number;
  quoted: number;
  unread: number;
  awardedTo: string | null;
  orderId: string | null;
  orderNumber: string | null;
  buyer: string | null;
  orderSource: string | null;
  lotNo: number | null;
}

export interface Quote {
  id: string;
  threadId: string;
  messageId: string | null;
  revision: number;
  currency: string;
  amount: string;
  perContainer: boolean;
  surcharges: string | null;
  freeDays: number | null;
  transitDays: number | null;
  validUntil: string | null;
  notes: string | null;
  auto: boolean;
  evidence: string[] | null;
  createdAt: string;
}

export interface ThreadRow {
  id: string;
  carrier: string;
  contactName: string | null;
  contactEmail: string;
  status: string;
  ownerUserId: string;
  ownerName: string | null;
  remindersSent: number;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  unread: number;
  messages: number;
  replies: number;
  quoteRounds: number;
  latestQuote: Quote | null;
  latestQuoteText: string | null;
}

export interface RankedRow {
  id: string;
  threadId: string;
  carrier: string;
  currency: string;
  amount: string;
  perContainer: boolean;
  surcharges: string | null;
  freeDays: number | null;
  transitDays: number | null;
  validUntil: string | null;
  revision: number;
  auto: boolean;
  rank: number;
  totalUsd: number;
  totalInr: number | null;
  perContainerUsd: number;
  score: number;
  expired: boolean;
  saveVsNext: number | null;
  saveVsWorst: number | null;
  negotiatedUsd: number | null;
  reasons: string[];
}

export interface Enquiry {
  id: string;
  number: string;
  enquiryDate: string;
  status: string;
  shipmentId: string | null;
  portOfLoading: string;
  portOfDischarge: string;
  containerType: string;
  containerCount: number;
  commodity: string | null;
  grossWeightMt: string | null;
  readyDate: string | null;
  freeDaysWanted: number | null;
  incoterm: string | null;
  replyBy: string | null;
  reminderHours: number;
  notes: string | null;
  awardedThreadId: string | null;
  version: number;
  threads: ThreadRow[];
  comparison: { rows: RankedRow[]; warnings: string[]; usdInr: number | null };
  lot: { id: string; lotNo: number; piNumber: string | null } | null;
  myMailbox: string | null;
}

export interface Message {
  id: string;
  direction: 'in' | 'out';
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  attachments: { fileId: string; name: string; size: number; mime: string }[] | null;
  sentAt: string;
}

export interface ThreadDetail extends Omit<ThreadRow, 'messages'> {
  enquiry: { id: string; number: string; status: string };
  messages: Message[];
  quotes: Quote[];
}

export interface Template {
  id: string;
  name: string;
  kind: string;
  subject: string;
  body: string;
  isDefault: boolean;
  builtIn: boolean;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  carrier: string;
  partyType: string;
  reason: string;
  suggested: boolean;
  alreadySent: boolean;
}

export const THREAD_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  SENT: 'slate',
  REPLIED: 'blue',
  QUOTED: 'blue',
  NEGOTIATING: 'amber',
  AWARDED: 'green',
  REGRETTED: 'slate',
  NO_REPLY: 'red',
};
export const ENQUIRY_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = { OPEN: 'blue', AWARDED: 'green', CLOSED: 'slate', CANCELLED: 'red' };
export const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtWhen = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const usd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
export const inr = (n: number | null | undefined) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
