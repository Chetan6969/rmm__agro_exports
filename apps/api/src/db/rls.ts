/**
 * PostgreSQL Row Level Security — the database-level guarantee of company isolation.
 *
 * The app connects as a non-superuser role (rmm_app). Every request runs inside a
 * transaction that sets `app.company_id`; PostgreSQL itself then hides other companies'
 * rows, even if application code forgets a WHERE clause.
 *
 * Sharing: a company-scoped row is visible to another company only when a row in
 * sharing_policies grants it (all records, or a list of record ids).
 *
 * This SQL is idempotent and re-applied on every `db:migrate`.
 */
import { ENTITY_LIST, type EntityDef } from '@rmm/shared';
import { DOCUMENT_TABLE_NAMES } from './schema/documents.js';

const companyMasters = (ENTITY_LIST as readonly EntityDef[]).filter((e) => e.scope === 'company');

/** Extra company-scoped tables that are never shared. Transaction modules add theirs here. */
export const PRIVATE_COMPANY_TABLES = ['entity_defaults', 'number_series', 'number_counters', ...DOCUMENT_TABLE_NAMES];

const functions = /* sql */ `
create or replace function app_company_id() returns uuid
  language sql stable as
$$ select nullif(current_setting('app.company_id', true), '')::uuid $$;

create or replace function app_shared_to_me(p_entity text, p_source uuid, p_record uuid, p_need_write boolean)
  returns boolean language sql stable as
$$
  select exists (
    select 1 from sharing_policies p
     where p.entity = p_entity
       and p.source_company_id = p_source
       and p.target_company_id = app_company_id()
       and (p.record_ids is null or p_record = any(p.record_ids))
       and (not p_need_write or p.access = 'write')
  )
$$;
`;

function policies(table: string, shareKey: string | null): string {
  const own = `company_id = app_company_id()`;
  const read = shareKey ? `${own} or app_shared_to_me('${shareKey}', company_id, id, false)` : own;
  const write = shareKey ? `${own} or app_shared_to_me('${shareKey}', company_id, id, true)` : own;
  return `
alter table ${table} enable row level security;
alter table ${table} force row level security;
drop policy if exists ${table}_select on ${table};
drop policy if exists ${table}_insert on ${table};
drop policy if exists ${table}_update on ${table};
drop policy if exists ${table}_delete on ${table};
create policy ${table}_select on ${table} for select using (${read});
create policy ${table}_insert on ${table} for insert with check (${own});
create policy ${table}_update on ${table} for update using (${write}) with check (${write});
create policy ${table}_delete on ${table} for delete using (${own});
`;
}

const filesPolicy = `
alter table files enable row level security;
alter table files force row level security;
drop policy if exists files_access on files;
create policy files_access on files using (company_id is null or company_id = app_company_id())
  with check (company_id is null or company_id = app_company_id());
`;

export function rlsSql(appRole: string): string {
  const parts = [functions];
  for (const e of companyMasters) parts.push(policies(e.table, e.shareable ? e.key : null));
  for (const t of PRIVATE_COMPANY_TABLES) {
    // primary keys of these tables have no "id" column, so they are never shareable
    parts.push(policies(t, null));
  }
  parts.push(filesPolicy);
  parts.push(`
grant usage on schema public to ${appRole};
grant select, insert, update, delete on all tables in schema public to ${appRole};
grant usage, select on all sequences in schema public to ${appRole};
grant execute on all functions in schema public to ${appRole};
-- audit trail is append-only for the application
revoke update, delete, truncate on audit_logs from ${appRole};
`);
  return parts.join('\n');
}
