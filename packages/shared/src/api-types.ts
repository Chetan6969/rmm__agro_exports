/** Types shared by API responses and the web client. */

export interface SessionCompany {
  id: string;
  code: string;
  name: string;
}

export interface SessionInfo {
  user: { id: string; username: string; fullName: string; isSuperAdmin: boolean };
  activeCompany: SessionCompany | null;
  companies: SessionCompany[];
  /** Effective permissions in the active company ("module:action"). Super admins get all. */
  permissions: string[];
  /** Set when an admin created/reset the password: UI forces a change. */
  mustChangePassword: boolean;
}

export interface ListResult<T = Record<string, unknown>> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiErrorBody {
  error: string;
  /** What went wrong, in plain words. */
  message: string;
  /** What the user can do to fix it (where to go, what to change, whom to ask). */
  hint?: string;
  /** Field-level validation messages. */
  fields?: Record<string, string>;
}

export interface SharingPolicy {
  id: string;
  entity: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  access: 'read' | 'write';
  /** null = every record of the source company; otherwise only these records. */
  recordIds: string[] | null;
  note: string | null;
}

/** ISO 4217 code, e.g. USD. */
export const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/** A live market reference rate for one currency (Indian rupees per 1 unit). */
export interface LiveRate {
  code: string;
  /** Decimal string with 6 decimals, e.g. "94.243123". */
  rateToInr: string;
  /** Business date the provider published the rate for (YYYY-MM-DD). */
  rateDate: string;
  /**
   * ECB: European Central Bank reference rate.
   * ECB+fawazahmed0: ECB INR per USD divided by market currency per USD (currencies the ECB does not publish).
   * fawazahmed0: market data only (used when the ECB cannot be reached).
   */
  source: 'ECB' | 'ECB+fawazahmed0' | 'fawazahmed0';
  /** When the server last confirmed this rate with the provider (ISO timestamp). */
  fetchedAt: string;
}

export interface LiveRatesResponse {
  rates: LiveRate[];
  /** Last time the server checked the providers (ISO), null if never. */
  checkedAt: string | null;
  /** How often rates are re-checked when someone views them. */
  refreshMinutes: number;
  /** Set when the last refresh failed fully or partly; rates may then be older. */
  problem?: { message: string; hint: string };
}
