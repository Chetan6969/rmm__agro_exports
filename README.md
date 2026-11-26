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

Requirements: Node.js 22+, pnpm, and the PostgreSQL 16+ command-line tools on `PATH`
(Windows: add `C:\Program Files\PostgreSQL8in`). You do not need to touch an existing
PostgreSQL service: development uses its own cluster in `./.dev-db` on `localhost:55432`.

```bash
pnpm install
pnpm setup:dev      # one time: apps/api/.env with generated passwords, database cluster, migrations + RLS, seed
pnpm dev            # API :4000, web :5173 (open http://localhost:5173, sign in as "admin")
```

`setup:dev` prints the super admin's temporary password once (you choose a new one at first sign-in).
If `ADMIN_PASSWORD` is set in `apps/api/.env`, that password is used instead. Lost it?

```bash
pnpm --filter @rmm/api exec tsx --env-file=.env src/cli.ts reset-password admin
```

Day to day:

| Command | What it does |
|---|---|
| `pnpm start:dev` | start the development database, then the API and web app |
| `pnpm serve:lan` | run the built app for other computers on the office network (see below) |
| `pnpm demo:load` | add the demo company **DEMO** (buyers, products, PIs, production orders, invoices) — switch to it with Alt+C. Refused when `NODE_ENV=production` or the database is not on this computer |
| `pnpm demo:reset` | delete the DEMO company and everything in it; real companies are not touched |
| `pnpm db:reset -- --yes` | erase the whole local database and uploads, then set up and seed again (`--demo` also loads the demo) |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` | control the development database (needed again after a reboot) |
| `pnpm db:migrate` | apply new migrations after pulling changes |

Use another port with `DEV_DB_PORT` (and the same port in both URLs in `apps/api/.env`).
Deleting `.dev-db` and `apps/api/.env`, then running `pnpm setup:dev`, gives a fresh local database
(this erases local test data only).

To use an existing PostgreSQL server instead, copy `apps/api/.env.example` to `apps/api/.env`, point
`DATABASE_ADMIN_URL` at a superuser and `DATABASE_URL` at the app role, then run `pnpm db:setup` and `pnpm db:seed`.

Then in the app: create each company → adjust roles → create users and tick their roles per company →
set numbering (enter your current Excel numbers in **Next no.**) → set sharing between companies if needed.

## Tests

```bash
pnpm --filter @rmm/api test     # uses a separate database <name>_test, created automatically
```

The integration tests prove the important guarantees: cross-company isolation (including raw SQL under RLS),
sharing (read / write / record-level / revoke), privilege-escalation guards, membership revocation,
optimistic locking, audit immutability, gap-free numbering under 25 parallel saves, upload validation.

## Office network from this Windows PC (quick)

To let other computers on the office network (Ethernet or Wi-Fi) use the ERP running on this PC:

```bash
pnpm serve:lan            # build, migrate, then serve website + API on port 4000 for the LAN
pnpm serve:lan --no-build # same, without rebuilding (nothing changed since the last run)
```

It prints the addresses to open on other computers, e.g. `http://192.168.1.20:4000` (wired adapter first).
Stop `pnpm dev` first (both use port 4000). The database stays on localhost; only port 4000 is reachable.

One-time Windows setup on this PC (in **PowerShell as Administrator**):

```powershell
New-NetFirewallRule -DisplayName "RMM Export ERP (TCP 4000)" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private,Domain
Get-NetConnectionProfile   # the office network must show NetworkCategory : Private (or DomainAuthenticated)
```

If it shows `Public`, change it to Private in Settings → Network & internet → Ethernet → Network profile type.
Give this PC a fixed IP (DHCP reservation in the router, or a static IP) so the address does not change.

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

Also back up `apps/api/storage/` (uploaded logos, seals, signatures, mail attachments) and keep a copy of `MAIL_SECRET_KEY`.

## Email: freight quotations

Sales → **Freight quotations** asks shipping lines and forwarders for ocean freight by email, reads their
replies back into the ERP, helps negotiate in the same mail thread and ranks the offers by best value.

**How it works**

1. Each user connects **their own mailbox** once (Sales → My mailbox): they pick **Google** (default —
   Gmail and company mail on Google Workspace), **Microsoft** (Outlook / Microsoft 365) or **Yahoo**, then
   enter the email address and an *app password*. The SMTP/IMAP servers are fixed per provider in the ERP;
   users never type server settings. The connection is tested before it is saved. The password is stored encrypted (AES-256-GCM with `MAIL_SECRET_KEY`) and never shown again.
2. Save shipping-line contacts in Masters → **Freight contacts** (the ports / routes they quote help the ERP
   suggest them). Mail texts live in Masters → **Email templates** (rate request, reminder, counter offer,
   award, regret). In the editor every value shows as a box with its real content (e.g. **[Mundra]**,
   **[Ravi]**): press `/` to list all values (↑ ↓ to choose, Enter to insert, Esc to close), Backspace or
   Delete twice next to a box removes it, and one space is kept on each side of a box. Saved as
   `{{pol}}`-style placeholders. Built-in texts are used until you save your own.
3. Create an enquiry (or press **Get freight quotes** on a shipment lot — route, containers and cargo are
   filled in) and choose contacts. Each contact gets a personal mail **from your address** (nodemailer/SMTP),
   tagged `[FQ <number>]` in the subject.
4. Replies arrive in your normal inbox. Every `MAIL_POLL_MINUTES` the server reads new INBOX mail over IMAP
   (imapflow + mailparser; also the **Check now** button). Replies are matched to their conversation by the
   mail headers (In-Reply-To / References), or by the `[FQ …]` tag and sender when a mail client dropped them.
   Unrelated mail is ignored and left untouched. Attachments are saved with the conversation.
5. The rate, currency, free days, transit time and validity are **read from each reply automatically** and
   marked "check" until a user confirms or corrects them. Counter offers and other replies are sent from
   the ERP in the same thread; every new offer is a new round.
6. **Best value** ranking uses each carrier's latest offer: total for all containers converted to US dollars
   with the Masters → Currencies rates (70% of the score), transit time (15%) and free days (15%); expired
   offers drop to the bottom. It also shows the saving against the next offer and how much negotiation saved.
7. **Book** the winner: the confirmation mail goes to them, a polite regret to the others who replied, and
   (for a lot) the freight is put on the lot's charges in ₹. Contacts who never reply get automatic
   reminders after the enquiry's reminder window.

**Server settings** (`apps/api/.env`; `pnpm setup:dev` creates the key for you):

| Setting | Default | Meaning |
| --- | --- | --- |
| `MAIL_SECRET_KEY` | — (required) | Encrypts saved app passwords. Any long random text: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Back it up; if it changes, users re-enter their app password. |
| `MAIL_POLL_MINUTES` | `5` | How often connected mailboxes are checked for replies. `0` = only on "Check now". |
| `MAIL_REMINDER_HOURS` | `48` | Default reminder window for new enquiries (`0` = no reminders). |
| `MAIL_MAX_REMINDERS` | `2` | Most reminders per contact and enquiry. |
| `MAIL_LOOKBACK_DAYS` | `30` | On first connection, only mail of the last N days is read. |
| `MAIL_MAX_ATTACHMENT_MB` | `10` | Bigger reply attachments are listed, not saved. |

**Getting an app password**

| Provider | Servers (filled in automatically) | App password |
| --- | --- | --- |
| Google (Gmail / Google Workspace) | smtp.gmail.com:465 SSL · imap.gmail.com:993 SSL | Turn on 2-Step Verification, then Google Account → Security → App passwords. In Gmail settings → Forwarding and POP/IMAP, enable IMAP. |
| Microsoft (Outlook / Microsoft 365) | smtp.office365.com:587 STARTTLS · outlook.office365.com:993 SSL | Microsoft account → Security → Advanced security options → App passwords (needs two-step verification). Work accounts: the admin must allow SMTP AUTH and IMAP for the mailbox. |
| Yahoo | smtp.mail.yahoo.com:465 · imap.mail.yahoo.com:993 | Account security → Generate app password. |

The server needs outbound access to the mail servers (ports 465/587 and 993). Mail is only read from
INBOX and is never deleted or marked as read.

## Export flow: semi-automatic orders, planning and documents

The ERP reads the export paperwork itself and proposes the next step; a person checks and confirms.
Everything is read **on this server** — no document or text is sent to any cloud or AI service.

**Start here: Export flow → Orders.** Every PO / PI is one file: where it stands and what to do next, its
lots, its documents (a folder for the order papers and one per lot, with upload buttons), plan and packaging,
purchases, freight and payments. The Document inbox, Shipments, Shipment tracker, Purchase orders, Purchase
invoices and Freight lists are also grouped by order: click an order to open what is inside. Orders from a
buyer's own PO and our PIs carry different tags and can be listed apart (*Buyer PO* / *Our PI*).

**1. Orders without a PI.** An order (Sales → Orders & PIs) now says how it came: *Our PI* or
*Buyer PO / contract*. When the buyer sends their own PO, no PI is shared: the order is planned,
produced and shipped straight from it, and prints as an *Order confirmation*. Order lines carry the
destination port, the dispatch date (days 1–15 = P1, 16–end = P2) and the buyer's item code.

**2. Document inbox** (Export flow → Document inbox). Drop any file — PDF, scan or phone photo,
Excel (.xlsx/.xls), Word (.docx/.doc), text:
- PDFs with a text layer are read directly; scans and photos go through **offline OCR**
  (Tesseract, English and Hindi models bundled in `node_modules`, nothing downloaded at run time;
  a page that reads poorly as English is read again as Hindi + English).
- The type is recognised (buyer PO / contract, PI, LC, booking, BL, shipping bill, export invoice,
  packing list, COO, phyto, fumigation, health certificate, COC, test report, APEDA/COI, bill of exchange,
  EIA intimation, traceability, our purchase order to a supplier, a supplier's purchase invoice) and its fields are read with the words they came from.
- It is matched to its order and lot by the numbers in it (our invoice no., buyer PO, LC, BL / booking no.).
- The review screen shows the original beside the values; confirming creates the order (buyer PO),
  adds the LC, updates the lot (booking, BL, shipping bill / LEO, invoice), enters the purchase invoice
  against its supplier and purchase order, or ticks the lot's checklist.
- Every correction is remembered for that document layout, so the next document from the same sender
  is read right. Duplicates (same file) are recognised; deleted items go to the recycle bin.

A buyer PO with a **delivery schedule** (pack such as 4 x 10 KG, destination city, month, P1 / P2) has its item
lines split by it, with dispatch dates and the right packing. Sentences naming packaging suppliers
("procure the bags from X and seals from Y") are read too and pre-fill the supplier on those packaging lines.
Check both on the review screen.

**3. Automatic planning** (order → Plan shipments → Automatic plan). Order lines become lots by dispatch
window, port by port, at most *N* containers a lot; each lot gets bags and 20' containers from the
packing master (net kg per bag, MT per container). Preview, then create.

**4. Packaging** (same page). Outer bags, inner packs (4 × 10 kg → 4), tags, strips and seals for the
planned bags plus a spare % (bags shipped free); pick the supplier and rate per line, then
**Create purchase orders** — one numbered, printable PO per supplier (Purchases → Purchase orders).

**5. Shipment tracker** (Export flow → Shipment tracker) — the old Track Sheet: every lot with line,
booking, invoice, BL status, LC, vessel / ETA, documents done / needed (Gulf and EU checklists) and
payment, with alerts (ship date passed, vessel arrived without BL, LEO done without BL, documents missing).

**Buying side (Purchases menu), kept apart from sales.**
- **Purchase orders** — what we order from suppliers: packaging made from an order's plan, or typed in
  (`Alt+N`) for paddy / rice, services and other things. Each shows how much of it has been billed.
- **Purchase invoices** — the bills suppliers send: entered by hand or confirmed from a scan in the inbox,
  linked to the supplier, the purchase order, the order and the lot, with GST, due date and what is paid.
  The same supplier invoice number cannot be entered twice.
- Inside an order file the **Purchases** tab (`Alt+4`) shows both, in separate blocks (`Alt+O` new purchase
  order, `Alt+I` new purchase invoice). Each has its own permission, and deleted ones go to the recycle bin.

**Old folders.** Read a **local copy** of the document share (never the share itself) into the inbox,
or measure how well documents are read, from the server:

```bash
pnpm --filter @rmm/api intake:import -- "D:/rmm-company-data/Export sales - RMM Agro Export Pvt Ltd/FY 2026-27" --company RMM --limit 500
pnpm --filter @rmm/api intake:accuracy -- "D:/rmm-company-data/…/FY 2026-27/Gulf" --limit 300 --out accuracy.csv
```

`INTAKE_MAX_MB` (default 40) limits one upload. Scans take a few seconds a page; documents are read one
at a time in the background and resume after a restart.

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
- Mailbox app passwords are encrypted with `MAIL_SECRET_KEY` (AES-256-GCM) and never returned by the API. Received mail is shown as plain text (no remote images or scripts); attachments that are not images or PDFs download instead of opening.
