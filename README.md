# RMM Export ERP

Rice export management for a group of companies: multi-company with database-enforced isolation,
policy-based data sharing, dynamic roles and permissions, audit trail, and a keyboard-first UI.

Stack: TypeScript · Fastify · Drizzle ORM · PostgreSQL (Row Level Security) · React + Vite · Tailwind.
No Docker: runs on Node.js and a local PostgreSQL on the office LAN server.

```
apps/api         Fastify API (also serves the built web app in production)
apps/web         React app (keyboard-first)
packages/shared  Master registry, permission catalog, validation, numbering. Used by API and web
```

## What is built (phase 1: foundation)

| Area | Status |
|---|---|
| Masters: companies (letterhead, logo, seal, signature, IEC, GST, APEDA, LUT…), bank accounts, customers/buyers, suppliers/millers, CHA/forwarders, products, packing types, units, countries, ports, shipping lines, currencies (default rates), payment terms, T&C templates | ✅ |
| Per-company default values for every master form (`Alt+D` on a new form) | ✅ |
| Users, roles created from the UI, permission matrix (module × view/create/edit/delete/approve/print/export), roles per company | ✅ |
| Company isolation enforced by PostgreSQL RLS (not only app code) | ✅ |
| Data sharing policies: share a master with another company, all or selected records, read or read+edit | ✅ |
| Audit log (field-level before/after, logins, exports), append-only | ✅ |
| Document numbering per company / document type / financial year, gap-free, continue from Excel numbers | ✅ |
| Soft delete with mandatory reason, optimistic locking (no silent overwrite) | ✅ |
| Keyboard: command palette, Enter-to-next-field forms, grid navigation, shortcuts on every screen (`F1`) | ✅ |
| Sales flow, purchase, shipment & logistics, PDF documents, payments, reports | Next phases (see below) |

## First-time setup (development machine)

Requirements: Node.js 22+, pnpm, PostgreSQL 15+ running locally.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # then edit: set a strong APP_DB_PASSWORD (also in DATABASE_URL)
pnpm db:setup                               # creates DB + non-superuser app role, migrations, RLS
pnpm db:seed                                # first super admin + starter roles + currencies/ports/countries…
pnpm dev                                    # API :4000, web :5173 (open http://localhost:5173)
```

`db:seed` prints the super admin's temporary password once. If you lose it:

```bash
pnpm --filter @rmm/api exec tsx --env-file=.env src/cli.ts reset-password admin
```

Then in the app: create each company → adjust roles → create users and tick their roles per company →
set numbering (enter your current Excel numbers in **Next no.**) → set sharing between companies if needed.

## Tests

```bash
pnpm --filter @rmm/api test     # uses a separate database <name>_test, created automatically
```

The integration tests prove the important guarantees: cross-company isolation (including raw SQL under RLS),
sharing (read / write / record-level / revoke), privilege-escalation guards, membership revocation,
optimistic locking, audit immutability, gap-free numbering under 25 parallel saves, upload validation.

## Production on the office LAN (no Docker)

On the server (Ubuntu example):

```bash
pnpm install --frozen-lockfile
pnpm build                                   # builds web → apps/web/dist and API → apps/api/dist
cd apps/api && cp .env.example .env          # NODE_ENV=production, real passwords
node --env-file=.env dist/cli.js setup       # first time only
node --env-file=.env dist/cli.js seed        # first time only
```

`/etc/systemd/system/rmm-erp.service`:

```ini
[Unit]
Description=RMM Export ERP
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/rmm-erp/apps/api
ExecStartPre=/usr/bin/node --env-file=.env dist/cli.js migrate
ExecStart=/usr/bin/node --env-file=.env dist/main.js
Restart=always
User=rmm

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now rmm-erp
```

Users open `http://<server-ip>:4000`. For HTTPS on the LAN put Caddy/nginx in front and set `COOKIE_SECURE=true` and `TRUST_PROXY=true` (so the login rate limit and audit log see real client IPs). Leave `TRUST_PROXY=false` when browsers connect to the API directly; otherwise any client could fake its IP.

**Backups (do this from day one):**

```bash
# crontab -e  (daily 1 AM, keep 30 days)
0 1 * * * pg_dump -Fc rmm_export_erp > /backup/rmm_$(date +\%F).dump && find /backup -name 'rmm_*.dump' -mtime +30 -delete
```

Also back up `apps/api/storage/` (uploaded logos, seals, signatures).

## How it is built to grow

**Add a master:** add an `EntityDef` in `packages/shared/src/entities.ts`, then
`pnpm db:generate && pnpm db:migrate`. Table, validation, RLS policy, permissions, menu, list, form,
search, export and audit come from that one definition.

**Add a transaction module** (e.g. Proforma Invoice):
1. Tables in `apps/api/src/db/schema/` with `company_id` + `recordColumns()`; add the table name to
   `PRIVATE_COMPANY_TABLES` in `apps/api/src/db/rls.ts` so RLS isolates it.
2. Register its permission module in `packages/shared/src/permissions.ts` (it appears in the role matrix;
   Administrator gets it automatically).
3. Routes: wrap work in `inTenantTx(ctx, tx => …)`, check `requirePerm`, call `allocateNumber(tx, ctx, docType, date)`
   for the document number and `audit(tx, …)` in the same transaction.
4. Screen in `apps/web/src/pages`, add it to `apps/web/src/lib/nav.ts` (sidebar + `Ctrl+K`).

## Security model (short)

- Sessions: random token in an httpOnly, SameSite=strict cookie. Only its SHA-256 is stored. Sliding expiry. Login rate-limited. Passwords use argon2id.
- Every request runs in a transaction with `app.company_id` set from the session (never from the client). PostgreSQL RLS policies on every company table enforce isolation. The app's DB role is not a superuser and cannot bypass RLS.
- Permissions are checked on every endpoint. Sub-admins cannot grant permissions they do not hold or manage companies they are not admins of.
- Uploads are checked by magic bytes (PNG/JPG/WEBP/PDF only; SVG rejected). CSV export neutralises spreadsheet formulas.
- The audit log is append-only at the database level (UPDATE/DELETE revoked).
