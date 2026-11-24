/**
 * Load a production export (made in the browser from the live app's own read-only API) into a
 * separate local company, for demos and trying changes on real data without touching production.
 *
 *   pnpm copy:load -- <export.json> [CODE]   default company code RMMDEMO
 *   pnpm copy:reset -- [CODE]                remove that company and everything in it
 *
 * Record ids are kept, so every link (PI → production order → invoice → B/L → certificate,
 * shipments, masters) survives. Shared lists (currencies, countries, ports, shipping lines,
 * units) are matched to this database's own rows by code. Only columns this version of the
 * app knows are copied; anything newer in the export is skipped and reported.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DOC_LIST, ENTITY_LIST, type EntityDef } from '@rmm/shared';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PgTable } from 'drizzle-orm/pg-core';
import { config } from '../config.js';
import { adminSql } from './client.js';
import { companies, docTables, files, masterTables, shipmentCharges, shipments, shipmentStages } from './schema/index.js';

type Row = Record<string, unknown>;
interface Export {
  source: string;
  exportedAt: string;
  scopes: Record<string, string>;
  masters: Record<string, Row[]>;
  globals: Record<string, { id: string; code: string | null; name: string | null }[]>;
  documents: Record<string, (Row & { lines?: Row[]; terms?: Row[]; containers?: Row[] })[]>;
  shipments: (Row & { charges?: Row[]; pipeline?: { steps: { key: string; doc: string | null; done: boolean; date: string | null; note: string | null }[] } })[];
  payments: Row[];
  files: Record<string, { mime: string; base64: string }>;
}

const entities = ENTITY_LIST as readonly EntityDef[];

/** Keeps only the columns this table has; timestamps become Dates. Reports dropped keys. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows are checked against the table columns at run time
function fit(table: PgTable, row: Row, skipped: Set<string>, label: string): any {
  const cols = getTableColumns(table) as Record<string, { columnType: string }>;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const col = cols[k];
    if (!col) {
      if (v !== null && v !== undefined && typeof v !== 'object') skipped.add(`${label}.${k}`);
      continue;
    }
    out[k] = col.columnType === 'PgTimestamp' && typeof v === 'string' ? new Date(v) : v;
  }
  return out;
}

/** Replaces every production id of a shared list by this database's id (deep, in place). */
function remap(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === 'string') return map.get(v) ?? v;
  if (Array.isArray(v)) return v.map((x) => remap(x, map));
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x, map)]));
  return v;
}

/** Company masters in an order where every referenced company master is inserted first. */
function masterOrder(keys: string[]): string[] {
  const done: string[] = [];
  const pending = new Set(keys);
  while (pending.size) {
    const ready = [...pending].filter((k) => {
      const def = entities.find((e) => e.key === k)!;
      return def.fields.every((f) => f.type !== 'ref' || f.ref === k || !pending.has(f.ref!));
    });
    if (!ready.length) throw new Error(`Circular master references: ${[...pending].join(', ')}`);
    for (const k of ready) {
      done.push(k);
      pending.delete(k);
    }
  }
  return done;
}

export async function importCopy(file: string, code = 'RMMDEMO') {
  if (!/^[A-Z0-9][A-Z0-9-]{1,11}$/.test(code)) throw new Error('Company code: 2–12 capital letters, digits or "-", e.g. RMMDEMO');
  const data = JSON.parse(await readFile(file, 'utf8')) as Export;
  if (!data.masters?.companies?.length) throw new Error('This file is not a production export (no company in it).');
  const conn = adminSql();
  const db = drizzle(conn);
  const skipped = new Set<string>();
  const missingGlobals: string[] = [];
  try {
    const prodCompany = data.masters.companies[0];
    const [taken] = await db.select({ id: companies.id, code: companies.code }).from(companies).where(sql`${companies.id} = ${prodCompany.id} or ${companies.code} = ${code}`);
    if (taken) throw new Error(`Company ${taken.code} already exists here. Run "pnpm copy:reset -- ${taken.code}" first to load a fresh copy.`);

    // shared lists: production id → local id, matched by code (or name when there is no code)
    const map = new Map<string, string>();
    for (const [key, rows] of Object.entries(data.globals)) {
      const t = masterTables[key];
      const local = (await db.select().from(t)) as Row[];
      for (const r of rows) {
        const hit = local.find((l) => (r.code ? l.code === r.code : l.name === r.name));
        if (hit) map.set(r.id, hit.id as string);
        else missingGlobals.push(`${key}:${r.code ?? r.name}`);
      }
    }

    await db.transaction(async (tx) => {
      // branding images (kept as group assets, same ids)
      for (const [id, f] of Object.entries(data.files)) {
        const buf = Buffer.from(f.base64, 'base64');
        const ext = f.mime === 'image/png' ? 'png' : f.mime === 'image/jpeg' ? 'jpg' : f.mime === 'image/webp' ? 'webp' : 'bin';
        const rel = path.join('imported', `${id}.${ext}`);
        await mkdir(path.join(config.storageDir, 'imported'), { recursive: true });
        await writeFile(path.join(config.storageDir, rel), buf);
        await tx
          .insert(files)
          .values({ id, companyId: null, originalName: `${id}.${ext}`, mimeType: f.mime, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), storagePath: rel })
          .onConflictDoNothing();
      }

      // company (same id, local code so it never clashes with a real company)
      await tx.insert(companies).values(fit(companies, remap({ ...prodCompany, code, name: `${prodCompany.name} (copy)` }, map) as Row, skipped, 'companies'));

      const companyKeys = Object.keys(data.masters).filter((k) => k !== 'companies' && masterTables[k]);
      for (const key of masterOrder(companyKeys)) {
        for (const r of data.masters[key]) await tx.insert(masterTables[key]).values(fit(masterTables[key], remap(r, map) as Row, skipped, key));
      }

      for (const def of DOC_LIST) {
        const t = docTables[def.key];
        for (const d of data.documents[def.key] ?? []) {
          const { lines = [], terms = [], containers = [], ...header } = remap(d, map) as typeof d;
          await tx.insert(t.header).values(fit(t.header, header, skipped, def.key));
          if (t.lines) for (const l of lines) await tx.insert(t.lines).values(fit(t.lines, l, skipped, `${def.key}.lines`));
          if (t.terms) for (const x of terms) await tx.insert(t.terms).values(fit(t.terms, x, skipped, `${def.key}.terms`));
          if (t.containers) for (const c of containers) await tx.insert(t.containers).values(fit(t.containers, c, skipped, `${def.key}.containers`));
        }
      }

      for (const s of data.shipments) {
        const { charges = [], pipeline, ...row } = remap(s, map) as typeof s;
        await tx.insert(shipments).values(fit(shipments, row, skipped, 'shipments'));
        for (const c of charges) await tx.insert(shipmentCharges).values(fit(shipmentCharges, c, skipped, 'shipmentCharges'));
        // manual pipeline steps (document steps follow from the links)
        for (const st of pipeline?.steps ?? []) {
          if (st.doc || !st.done) continue;
          await tx.insert(shipmentStages).values({ companyId: row.companyId as string, shipmentId: row.id as string, stageKey: st.key, done: true, doneDate: st.date, note: st.note });
        }
      }
    });
    const counts = Object.fromEntries(DOC_LIST.map((d) => [d.key, data.documents[d.key]?.length ?? 0]));
    return { code, companyId: prodCompany.id as string, counts, shipments: data.shipments.length, skipped: [...skipped].sort(), missingGlobals };
  } finally {
    await conn.end();
  }
}

/** Deletes the copy company (and everything in it). Refuses codes that do not look like a copy. */
export async function resetCopy(code = 'RMMDEMO') {
  const conn = adminSql();
  const db = drizzle(conn);
  try {
    const [c] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.code, code));
    if (!c) return false;
    if (!String(c.name).endsWith('(copy)')) throw new Error(`${code} is not an imported copy (its name does not end with "(copy)"); refusing to delete it.`);
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const tables = await tx.execute<{ table_name: string }>(
        sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'company_id' and table_name <> 'companies'`,
      );
      for (const { table_name } of tables) await tx.execute(sql`delete from ${sql.identifier(table_name)} where company_id = ${c.id}`);
      await tx.execute(sql`delete from sharing_policies where source_company_id = ${c.id} or target_company_id = ${c.id}`);
      await tx.execute(sql`update users set default_company_id = null where default_company_id = ${c.id}`);
      await tx.execute(sql`update sessions set active_company_id = null where active_company_id = ${c.id}`);
      await tx.execute(sql`delete from companies where id = ${c.id}`);
    });
    return true;
  } finally {
    await conn.end();
  }
}
