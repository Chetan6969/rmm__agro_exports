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
