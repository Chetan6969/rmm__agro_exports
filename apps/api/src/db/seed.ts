/**
 * Idempotent seed: first super admin, starter roles, baseline global masters.
 * Re-running never duplicates rows and never overwrites edits (matches on code / name).
 */
import { randomBytes } from 'node:crypto';
import { MODULES, perm, type Action } from '@rmm/shared';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { adminSql } from './client.js';
import * as schema from './schema/index.js';
import { masterTables, rolePermissions, roles, users } from './schema/index.js';

const CURRENCIES = [
  ['INR', 'Indian Rupee', '₹', '1', 'Paise'],
  ['USD', 'US Dollar', '$', '84', 'Cents'],
  ['EUR', 'Euro', '€', '91', 'Cents'],
  ['GBP', 'Pound Sterling', '£', '108', 'Pence'],
  ['AED', 'UAE Dirham', 'AED', '22.9', 'Fils'],
  ['SAR', 'Saudi Riyal', 'SAR', '22.4', 'Halalas'],
];

const COUNTRIES: [string, string, string][] = [
  ['IN', 'India', 'South Asia'], ['AE', 'United Arab Emirates', 'Middle East'], ['SA', 'Saudi Arabia', 'Middle East'],
  ['IR', 'Iran', 'Middle East'], ['IQ', 'Iraq', 'Middle East'], ['KW', 'Kuwait', 'Middle East'], ['OM', 'Oman', 'Middle East'],
  ['QA', 'Qatar', 'Middle East'], ['BH', 'Bahrain', 'Middle East'], ['YE', 'Yemen', 'Middle East'], ['JO', 'Jordan', 'Middle East'],
  ['TR', 'Turkey', 'Europe'], ['GB', 'United Kingdom', 'Europe'], ['NL', 'Netherlands', 'Europe'], ['DE', 'Germany', 'Europe'],
  ['IT', 'Italy', 'Europe'], ['BE', 'Belgium', 'Europe'], ['FR', 'France', 'Europe'], ['US', 'United States', 'Americas'],
  ['CA', 'Canada', 'Americas'], ['AU', 'Australia', 'Oceania'], ['NZ', 'New Zealand', 'Oceania'],
  ['BD', 'Bangladesh', 'South Asia'], ['NP', 'Nepal', 'South Asia'], ['LK', 'Sri Lanka', 'South Asia'],
  ['MY', 'Malaysia', 'South-East Asia'], ['SG', 'Singapore', 'South-East Asia'], ['ID', 'Indonesia', 'South-East Asia'],
  ['PH', 'Philippines', 'South-East Asia'], ['VN', 'Vietnam', 'South-East Asia'], ['CN', 'China', 'East Asia'],
  ['BJ', 'Benin', 'Africa'], ['TG', 'Togo', 'Africa'], ['SN', 'Senegal', 'Africa'], ['CI', "Côte d'Ivoire", 'Africa'],
  ['GN', 'Guinea', 'Africa'], ['GH', 'Ghana', 'Africa'], ['NG', 'Nigeria', 'Africa'], ['KE', 'Kenya', 'Africa'],
  ['TZ', 'Tanzania', 'Africa'], ['MZ', 'Mozambique', 'Africa'], ['SO', 'Somalia', 'Africa'], ['DJ', 'Djibouti', 'Africa'],
  ['ZA', 'South Africa', 'Africa'], ['EG', 'Egypt', 'Africa'], ['LR', 'Liberia', 'Africa'], ['CM', 'Cameroon', 'Africa'],
];

// [code, name, country, type, isLoading]
const PORTS: [string, string, string, string, boolean][] = [
  ['INMUN1', 'Mundra', 'IN', 'Sea', true], ['INIXY1', 'Kandla', 'IN', 'Sea', true], ['INNSA1', 'Nhava Sheva (JNPT)', 'IN', 'Sea', true],
  ['INMAA1', 'Chennai', 'IN', 'Sea', true], ['INCCU1', 'Kolkata', 'IN', 'Sea', true], ['INVTZ1', 'Visakhapatnam', 'IN', 'Sea', true],
  ['INKAK1', 'Kakinada', 'IN', 'Sea', true], ['INPAV1', 'Pipavav', 'IN', 'Sea', true], ['INTUT1', 'Tuticorin', 'IN', 'Sea', true],
  ['INTKD6', 'ICD Tughlakabad', 'IN', 'ICD', true], ['INPPG6', 'ICD Patparganj', 'IN', 'ICD', true], ['INLDH6', 'ICD Ludhiana', 'IN', 'ICD', true],
  ['AEJEA', 'Jebel Ali', 'AE', 'Sea', false], ['SADMM', 'Dammam', 'SA', 'Sea', false], ['SAJED', 'Jeddah', 'SA', 'Sea', false],
  ['IRBND', 'Bandar Abbas', 'IR', 'Sea', false], ['IQUQR', 'Umm Qasr', 'IQ', 'Sea', false], ['KWSAA', 'Shuwaikh', 'KW', 'Sea', false],
  ['OMSOH', 'Sohar', 'OM', 'Sea', false], ['QAHMD', 'Hamad', 'QA', 'Sea', false], ['YEADE', 'Aden', 'YE', 'Sea', false],
  ['GBFXT', 'Felixstowe', 'GB', 'Sea', false], ['NLRTM', 'Rotterdam', 'NL', 'Sea', false], ['USNYC', 'New York', 'US', 'Sea', false],
  ['BJCOO', 'Cotonou', 'BJ', 'Sea', false], ['TGLFW', 'Lomé', 'TG', 'Sea', false], ['SNDKR', 'Dakar', 'SN', 'Sea', false],
  ['CIABJ', 'Abidjan', 'CI', 'Sea', false], ['GNCKY', 'Conakry', 'GN', 'Sea', false], ['KEMBA', 'Mombasa', 'KE', 'Sea', false],
  ['TZDAR', 'Dar es Salaam', 'TZ', 'Sea', false], ['DJJIB', 'Djibouti', 'DJ', 'Sea', false], ['SOMGQ', 'Mogadishu', 'SO', 'Sea', false],
  ['BDCGP', 'Chittagong', 'BD', 'Sea', false], ['MYPKG', 'Port Klang', 'MY', 'Sea', false], ['SGSIN', 'Singapore', 'SG', 'Sea', false],
];

const SHIPPING_LINES: [string, string][] = [
  ['MAEU', 'Maersk'], ['MSCU', 'MSC'], ['CMDU', 'CMA CGM'], ['HLCU', 'Hapag-Lloyd'], ['ONEY', 'Ocean Network Express (ONE)'],
  ['COSU', 'COSCO Shipping'], ['EGLV', 'Evergreen'], ['YMLU', 'Yang Ming'], ['PCIU', 'PIL (Pacific International Lines)'],
  ['ZIMU', 'ZIM'], ['HDMU', 'HMM'], ['ESPU', 'Emirates Shipping Line'], ['SMLM', 'SCI (Shipping Corporation of India)'],
];

const UNITS: [string, string, string][] = [
  ['MT', 'Metric tonne', '1000'], ['KG', 'Kilogram', '1'], ['QTL', 'Quintal', '100'], ['BAG', 'Bag', ''], ['PCS', 'Pieces', ''],
];

const all = (module: string, actions: Action[]) => actions.map((a) => perm(module, a));
const mastersWith = (actions: Action[]) =>
  MODULES.filter((m) => m.key.startsWith('master.')).flatMap((m) => all(m.key, actions.filter((a) => m.actions.includes(a))));
const salesWith = (actions: Action[]) =>
  MODULES.filter((m) => m.key.startsWith('sales.')).flatMap((m) => all(m.key, actions.filter((a) => m.actions.includes(a))));

const STARTER_ROLES: { name: string; description: string; permissions: string[] }[] = [
  {
    name: 'Documentation Executive',
    description: 'Maintains parties, products and logistics masters; prepares documents',
    permissions: [...mastersWith(['view', 'create', 'edit', 'export']), ...salesWith(['view', 'create', 'edit', 'print', 'export']), perm('admin.numbering', 'view')],
  },
  {
    name: 'Accounts',
    description: 'Finance masters and bank accounts; read-only on the rest',
    permissions: [
      ...mastersWith(['view', 'export']),
      ...salesWith(['view', 'print', 'export']),
      ...all('master.bankAccounts', ['create', 'edit']),
      ...all('master.currencies', ['create', 'edit']),
      ...all('master.paymentTerms', ['create', 'edit']),
    ],
  },
  { name: 'Viewer', description: 'Read-only access to masters and sales documents', permissions: [...mastersWith(['view']), ...salesWith(['view'])] },
];

export async function seedDatabase(url?: string) {
  const conn = adminSql(url);
  const db = drizzle(conn, { schema, casing: 'snake_case' });
  try {
    await db.transaction(async (tx) => {
      // ---------------- super admin
      const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
      const [existing] = await tx.select({ id: users.id }).from(users).where(and(eq(users.username, username), isNull(users.deletedAt)));
      if (!existing) {
        const password = process.env.ADMIN_PASSWORD || `${randomBytes(6).toString('base64url')}9a`;
        await tx.insert(users).values({
          username,
          fullName: 'System Administrator',
          passwordHash: await argon2.hash(password),
          isSuperAdmin: true,
          mustChangePassword: !process.env.ADMIN_PASSWORD,
        });
        console.log(`\n  Super admin created  →  username: ${username}   password: ${password}`);
        if (!process.env.ADMIN_PASSWORD) console.log('  (random password: you will be asked to change it at first login)\n');
      }

      // ---------------- starter roles (Administrator is synced on every API start)
      for (const r of STARTER_ROLES) {
        const [found] = await tx.select({ id: roles.id }).from(roles).where(and(sql`lower(${roles.name}) = lower(${r.name})`, isNull(roles.deletedAt)));
        if (found) continue;
        const [row] = await tx.insert(roles).values({ name: r.name, description: r.description }).returning({ id: roles.id });
        await tx.insert(rolePermissions).values([...new Set(r.permissions)].map((permission) => ({ roleId: row.id, permission })));
      }

      // ---------------- global masters (insert missing codes only)
      const upsert = async (key: string, rows: Record<string, unknown>[]) => {
        const t = masterTables[key];
        for (const r of rows) {
          await tx.insert(t).values(r).onConflictDoNothing();
        }
      };
      await upsert('currencies', CURRENCIES.map(([code, name, symbol, exchangeRate, subunitName]) => ({ code, name, symbol, exchangeRate, subunitName, decimals: 2 })));
      await upsert('countries', COUNTRIES.map(([code, name, region]) => ({ code, name, region })));
      await upsert('units', UNITS.map(([code, name, kg]) => ({ code, name, kgFactor: kg || null })));
      await upsert('shippingLines', SHIPPING_LINES.map(([code, name]) => ({ code, name })));

      const countryIds = new Map(
        (await tx.select({ id: masterTables.countries.id, code: masterTables.countries.code }).from(masterTables.countries)).map((c) => [c.code as string, c.id as string]),
      );
      await upsert('ports', PORTS.map(([code, name, cc, portType, isLoading]) => ({ code, name, countryId: countryIds.get(cc), portType, isLoading })));
    });
    console.log('seed complete');
  } finally {
    await conn.end();
  }
}
