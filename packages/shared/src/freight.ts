/**
 * Freight quotations by email: provider presets for users' own mailboxes, message templates,
 * reading the rate out of a reply, and ranking the final (negotiated) quotes by best value.
 * Pure functions, shared by the API (authoritative) and the web app (previews).
 */

// ------------------------------------------------------------------ mailbox presets
export interface MailServerSettings {
  provider: string;
  smtpHost: string;
  smtpPort: number;
  /** true = TLS from the first byte (465); false = STARTTLS upgrade (587). */
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
}

export const MAIL_PROVIDERS: (MailServerSettings & { label: string; domains: string[]; passwordHelp: string })[] = [
  {
    provider: 'gmail',
    label: 'Google (Gmail / Google Workspace)',
    domains: ['gmail.com', 'googlemail.com'],
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    passwordHelp: 'Google Account → Security → 2-Step Verification (must be on) → App passwords → create one for "Mail". Use that 16-letter password here, not your normal password.',
  },
  {
    provider: 'outlook',
    label: 'Microsoft (Outlook / Microsoft 365)',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    passwordHelp: 'Microsoft account → Security → Advanced security options → App passwords (needs two-step verification). For Microsoft 365 work accounts your IT admin must allow SMTP AUTH and IMAP for the mailbox.',
  },
  {
    provider: 'yahoo',
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'yahoo.in', 'ymail.com'],
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    passwordHelp: 'Yahoo Account security → Generate app password.',
  },
];

export type MailProviderKey = 'gmail' | 'outlook' | 'yahoo';
/** The only providers users can pick; the server settings are fixed per provider (no typing). */
export const MAIL_PROVIDER_KEYS: readonly MailProviderKey[] = ['gmail', 'outlook', 'yahoo'];
/** Company domains usually run on Google Workspace, so Google is the default. */
export const DEFAULT_MAIL_PROVIDER: MailProviderKey = 'gmail';

/** The provider an email address obviously belongs to (outlook.com → Microsoft); null for company domains. */
export function detectMailProvider(email: string): (typeof MAIL_PROVIDERS)[number] | null {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  return MAIL_PROVIDERS.find((p) => domain && p.domains.includes(domain)) ?? null;
}

export const mailProvider = (key: string | null | undefined) => MAIL_PROVIDERS.find((p) => p.provider === key) ?? MAIL_PROVIDERS.find((p) => p.provider === DEFAULT_MAIL_PROVIDER)!;

// ------------------------------------------------------------------ templates
export const MAIL_TEMPLATE_KINDS = ['Rate request', 'Reminder', 'Counter offer', 'Award', 'Regret'] as const;
export type MailTemplateKind = (typeof MAIL_TEMPLATE_KINDS)[number];

export const TEMPLATE_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'contact_name', label: 'Contact person' },
  { key: 'carrier', label: 'Shipping line / forwarder' },
  { key: 'pol', label: 'Port of loading' },
  { key: 'pod', label: 'Port of discharge' },
  { key: 'containers', label: 'Containers (e.g. 20 × 20\' FCL)' },
  { key: 'commodity', label: 'Commodity' },
  { key: 'weight', label: 'Gross weight' },
  { key: 'ready_date', label: 'Cargo ready date' },
  { key: 'free_days', label: 'Free days wanted' },
  { key: 'incoterm', label: 'Incoterm' },
  { key: 'reference', label: 'Enquiry number' },
  { key: 'deadline', label: 'Reply by' },
  { key: 'their_rate', label: 'Their last quoted rate' },
  { key: 'target_rate', label: 'Our target rate' },
  { key: 'sender_name', label: 'Your name' },
  { key: 'company', label: 'Your company' },
];

/** Built-in texts, used until a company saves its own templates of that kind. */
export const DEFAULT_MAIL_TEMPLATES: Record<MailTemplateKind, { subject: string; body: string }> = {
  'Rate request': {
    subject: 'Freight rate request: {{pol}} to {{pod}}, {{containers}}',
    body: `Dear {{contact_name}},

Please quote your best ocean freight for the shipment below:

  Port of loading:   {{pol}}
  Port of discharge: {{pod}}
  Containers:        {{containers}}
  Commodity:         {{commodity}}
  Gross weight:      {{weight}}
  Cargo ready:       {{ready_date}}
  Free days needed:  {{free_days}} at destination

Kindly mention the rate per container with currency, surcharges (if any), transit time, free days and validity.

We would appreciate your reply by {{deadline}}.

Best regards,
{{sender_name}}
{{company}}`,
  },
  Reminder: {
    subject: 'Reminder: freight rate request {{pol}} to {{pod}}',
    body: `Dear {{contact_name}},

A gentle reminder for our rate request below ({{containers}}, {{pol}} to {{pod}}, ready {{ready_date}}). Please share your best rate at the earliest.

Best regards,
{{sender_name}}
{{company}}`,
  },
  'Counter offer': {
    subject: 'Re: freight rate {{pol}} to {{pod}}',
    body: `Dear {{contact_name}},

Thank you for your quote of {{their_rate}}. We have received more competitive offers for this route. If you can work at {{target_rate}} per container, we are ready to confirm the booking with you.

Please revert with your best possible rate.

Best regards,
{{sender_name}}
{{company}}`,
  },
  Award: {
    subject: 'Booking confirmation: {{pol}} to {{pod}}, {{containers}}',
    body: `Dear {{contact_name}},

We are pleased to confirm the booking with {{carrier}} at {{their_rate}} for {{containers}} from {{pol}} to {{pod}}, cargo ready {{ready_date}}.

Please send the booking confirmation and container release order.

Best regards,
{{sender_name}}
{{company}}`,
  },
  Regret: {
    subject: 'Re: freight rate {{pol}} to {{pod}}',
    body: `Dear {{contact_name}},

Thank you for your quote. This time we have finalised with another carrier. We look forward to working with you on upcoming shipments.

Best regards,
{{sender_name}}
{{company}}`,
  },
};

const VAR = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/**
 * Exactly one space on each side of every {{placeholder}}: runs of spaces collapse to one, and a
 * space is added where a placeholder touches a word. Punctuation ("{{name}},") and line edges stay.
 */
export function tidyTemplateSpacing(text: string): string {
  return (text ?? '')
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, '{{$1}}')
    .replace(/[ \t\u00a0]+(\{\{)/g, ' $1')
    .replace(/(\}\})[ \t\u00a0]+/g, '$1 ')
    .replace(/([^\s([{"'/-])(\{\{)/g, '$1 $2')
    .replace(/(\}\})([\p{L}\p{N}])/gu, '$1 $2')
    .replace(/(\}\})(\{\{)/g, '$1 $2');
}

/** Splits a template into text and placeholder parts (for the chip editor). */
export function templateParts(text: string): ({ text: string } | { key: string })[] {
  const out: ({ text: string } | { key: string })[] = [];
  let last = 0;
  for (const m of (text ?? '').matchAll(VAR)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ key: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < (text ?? '').length) out.push({ text: text.slice(last) });
  return out;
}

/** Fills {{placeholders}}; unknown or empty ones become "—" so nothing technical reaches the reader. */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return tidyTemplateSpacing(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = vars[key.toLowerCase()];
    return v === null || v === undefined || v === '' ? '—' : String(v);
  });
}

/** Subject tag that lets replies be matched even when a mail client drops the threading headers. */
export const enquiryTag = (number: string) => `[FQ ${number}]`;
export const findEnquiryTag = (subject: string): string | null => /\[FQ ([^\]]{1,40})\]/.exec(subject ?? '')?.[1]?.trim() ?? null;

// ------------------------------------------------------------------ reading a quote from a reply
export interface ExtractedQuote {
  currency: string | null;
  amount: string | null;
  /** Amount is per container (vs a lump sum for the whole lot). */
  perContainer: boolean;
  freeDays: number | null;
  transitDays: number | null;
  validUntil: string | null;
  /** Lines the values came from, shown to the user for checking. */
  evidence: string[];
}

const CURRENCY_WORDS: [RegExp, string][] = [
  [/US\s?\$|USD|\$/i, 'USD'],
  [/EUR|€/i, 'EUR'],
  [/AED/i, 'AED'],
  [/SAR/i, 'SAR'],
  [/GBP|£/i, 'GBP'],
  [/INR|Rs\.?|₹/i, 'INR'],
];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseDate(s: string, today: string): string | null {
  const y0 = Number(today.slice(0, 4));
  let m = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  m = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*,?\s*(\d{4})?/i.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(m[3] ? Number(m[3]) : y0, MONTHS[m[2].toLowerCase()], Number(m[1]));
  m = /([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(m[3] ? Number(m[3]) : y0, MONTHS[m[1].toLowerCase()], Number(m[2]));
  return null;
}
const iso = (y: number, mo: number, d: number) =>
  mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;

/**
 * Reads the offered rate, free days, transit time and validity out of a carrier's reply.
 * Only the new text is read (quoted earlier messages are cut off). Every value is a suggestion
 * the user confirms; lines it came from are returned as evidence.
 */
export function extractQuote(body: string, today: string): ExtractedQuote {
  const fresh = stripQuoted(body);
  const lines = fresh.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ExtractedQuote = { currency: null, amount: null, perContainer: true, freeDays: null, transitDays: null, validUntil: null, evidence: [] };
  const money = /(US\s?\$|USD|EUR|€|AED|SAR|GBP|£|INR|Rs\.?|₹|\$)\s?([\d][\d,]*(?:\.\d{1,2})?)|([\d][\d,]*(?:\.\d{1,2})?)\s?(USD|EUR|AED|SAR|GBP|INR)\b/i;
  const rateWords = /(ocean freight|o\/f|freight|rate|all[- ]in|per\s*(cntr|container|box|teu|20|40)|\/\s*(cntr|container|box|teu)|offer|quote)/i;
  const lumpWords = /\b(total|lump\s*sum|for all|for the (whole|entire))\b/i;
  // prefer a money amount on a line that talks about the rate
  const moneyLines = lines.filter((l) => money.test(l));
  const best = moneyLines.find((l) => rateWords.test(l)) ?? moneyLines[0];
  if (best) {
    const m = money.exec(best)!;
    const sym = m[1] ?? m[4] ?? '';
    const num = (m[2] ?? m[3]).replace(/,/g, '');
    out.currency = CURRENCY_WORDS.find(([re]) => re.test(sym))?.[1] ?? null;
    out.amount = num;
    out.perContainer = !lumpWords.test(best);
    out.evidence.push(best);
  }
  for (const l of lines) {
    let m = /(\d{1,3})\s*(?:days?)?\s*(?:combined\s*)?(?:free\s*(?:time|days)|of\s*free\s*time|detention\s*free|dem(?:urrage)?\/?det(?:ention)?\s*free)/i.exec(l) ?? /free\s*(?:time|days)?\s*[:=-]?\s*(\d{1,3})\s*days?/i.exec(l);
    if (m && out.freeDays === null) {
      out.freeDays = Number(m[1]);
      out.evidence.push(l);
    }
    m = /(?:transit(?:\s*time)?|t\/t|tt)\s*[:=-]?\s*(?:approx\.?\s*)?(\d{1,3})\s*(?:-\s*\d{1,3}\s*)?days?/i.exec(l) ?? /(\d{1,3})\s*days?\s*transit/i.exec(l);
    if (m && out.transitDays === null) {
      out.transitDays = Number(m[1]);
      out.evidence.push(l);
    }
    if (/valid(?:ity)?\s*(?:till|until|upto|up to|to|thru|through|:)/i.test(l) && out.validUntil === null) {
      const d = parseDate(l.replace(/.*valid(?:ity)?\s*(?:till|until|upto|up to|to|thru|through|:)\s*/i, ''), today);
      if (d) {
        out.validUntil = d;
        out.evidence.push(l);
      }
    }
  }
  out.evidence = [...new Set(out.evidence)];
  return out;
}

/** Cuts the quoted history ("On … wrote:", "> …", "-----Original Message-----") from a reply. */
export function stripQuoted(body: string): string {
  const lines = (body ?? '').split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^\s*(on .{3,120} wrote:|-{2,}\s*original message\s*-{2,}|from:\s.+@.+|_{5,})\s*$/i.test(l)) break;
    out.push(l);
  }
  return out.join('\n').trim();
}

// ------------------------------------------------------------------ best value ranking
export interface QuoteForRanking {
  id: string;
  carrier: string;
  currency: string;
  /** Rate per container (or lump sum when perContainer is false). */
  amount: string;
  perContainer: boolean;
  surcharges?: string | null;
  freeDays?: number | null;
  transitDays?: number | null;
  validUntil?: string | null;
}

export interface RankedQuote extends QuoteForRanking {
  rank: number;
  /** Total for the whole enquiry, in US dollars. */
  totalUsd: number;
  /** 0–100: 70 cost, 15 transit time, 15 free days (expired quotes score 0). */
  score: number;
  expired: boolean;
  /** Saving in USD against the next-best and the most expensive valid quote. */
  saveVsNext: number | null;
  saveVsWorst: number | null;
  reasons: string[];
}

/**
 * Ranks carriers' final quotes by best value. Totals are compared in US dollars (rates in
 * ₹ per unit, e.g. the live rates). Cheapest total earns the full 70 points, the dearest 0;
 * shortest transit and most free days add up to 15 each (unknown values get half).
 */
export function rankQuotes(quotes: QuoteForRanking[], opts: { containers: number; inrPerUnit: Record<string, number>; today: string }): RankedQuote[] {
  const usdRate = opts.inrPerUnit.USD || 1;
  const inr = (cur: string) => (cur === 'INR' ? 1 : (opts.inrPerUnit[cur] ?? NaN));
  const toUsd = (amount: number, cur: string) => (cur === 'USD' ? amount : (amount * inr(cur)) / usdRate);
  const rows = quotes.map((q) => {
    const unit = Number(q.amount) + Number(q.surcharges ?? 0);
    const total = q.perContainer ? unit * Math.max(1, opts.containers) : unit;
    return { ...q, totalUsd: Math.round(toUsd(total, q.currency) * 100) / 100, expired: !!q.validUntil && q.validUntil < opts.today };
  });
  const valid = rows.filter((r) => !r.expired && Number.isFinite(r.totalUsd));
  const span = (vals: number[]) => [Math.min(...vals), Math.max(...vals)] as const;
  const [cMin, cMax] = valid.length ? span(valid.map((r) => r.totalUsd)) : [0, 0];
  const transits = valid.map((r) => r.transitDays).filter((x): x is number => x != null);
  const frees = valid.map((r) => r.freeDays).filter((x): x is number => x != null);
  const [tMin, tMax] = transits.length ? span(transits) : [0, 0];
  const [fMin, fMax] = frees.length ? span(frees) : [0, 0];
  const part = (v: number | null | undefined, lo: number, hi: number, lowerIsBetter: boolean, weight: number) => {
    if (v == null) return weight / 2;
    if (hi === lo) return weight;
    const t = (v - lo) / (hi - lo);
    return weight * (lowerIsBetter ? 1 - t : t);
  };
  const scored = rows.map((r) => {
    if (r.expired || !Number.isFinite(r.totalUsd)) return { ...r, score: 0 };
    const score = part(r.totalUsd, cMin, cMax, true, 70) + part(r.transitDays, tMin, tMax, true, 15) + part(r.freeDays, fMin, fMax, false, 15);
    return { ...r, score: Math.round(score * 10) / 10 };
  });
  scored.sort((a, b) => Number(a.expired) - Number(b.expired) || b.score - a.score || a.totalUsd - b.totalUsd);
  const worstValid = valid.length ? Math.max(...valid.map((r) => r.totalUsd)) : null;
  return scored.map((r, i) => {
    const next = scored.slice(i + 1).find((x) => !x.expired);
    const reasons: string[] = [];
    if (r.expired) reasons.push('Quote validity has expired');
    else {
      if (r.totalUsd === cMin) reasons.push('Lowest total freight');
      if (r.transitDays != null && r.transitDays === tMin && transits.length > 1) reasons.push('Fastest transit');
      if (r.freeDays != null && r.freeDays === fMax && frees.length > 1) reasons.push('Most free days');
    }
    return {
      ...r,
      rank: i + 1,
      saveVsNext: !r.expired && next ? Math.round((next.totalUsd - r.totalUsd) * 100) / 100 : null,
      saveVsWorst: !r.expired && worstValid != null ? Math.round((worstValid - r.totalUsd) * 100) / 100 : null,
      reasons,
    };
  });
}

export const ENQUIRY_STATUSES = ['OPEN', 'AWARDED', 'CLOSED', 'CANCELLED'] as const;
export const THREAD_STATUSES = ['SENT', 'REPLIED', 'QUOTED', 'NEGOTIATING', 'AWARDED', 'REGRETTED', 'NO_REPLY'] as const;
