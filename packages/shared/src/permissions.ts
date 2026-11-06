import { ENTITY_LIST, type EntityDef } from './entities.js';

/**
 * Permission catalog: module × action.
 * Roles are created at runtime from the UI and store a subset of these keys ("module:action").
 * New modules (sales, shipment, ...) register here and immediately appear in the role matrix.
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'print', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

export interface ModuleDef {
  key: string;
  label: string;
  group: string;
  actions: readonly Action[];
}

const MASTER_ACTIONS: readonly Action[] = ['view', 'create', 'edit', 'delete', 'export'];

const masterModules: ModuleDef[] = (ENTITY_LIST as readonly EntityDef[]).map((e) => ({
  key: `master.${e.key}`,
  label: e.plural,
  group: `Masters · ${e.menu}`,
  actions: MASTER_ACTIONS,
}));

export const MODULES: ModuleDef[] = [
  ...masterModules,
  { key: 'admin.users', label: 'Users', group: 'Administration', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin.roles', label: 'Roles & permissions', group: 'Administration', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin.sharing', label: 'Data sharing policies', group: 'Administration', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'admin.numbering', label: 'Document numbering', group: 'Administration', actions: ['view', 'edit'] },
  { key: 'admin.defaults', label: 'Master default values', group: 'Administration', actions: ['view', 'edit'] },
  { key: 'admin.audit', label: 'Audit log', group: 'Administration', actions: ['view', 'export'] },
];

export const MODULE_MAP: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.key, m]));

export type PermissionKey = `${string}:${Action}`;

export const perm = (module: string, action: Action): PermissionKey => `${module}:${action}`;

export const ALL_PERMISSIONS: PermissionKey[] = MODULES.flatMap((m) => m.actions.map((a) => perm(m.key, a)));

export function isValidPermission(p: string): boolean {
  const idx = p.lastIndexOf(':');
  if (idx < 0) return false;
  const mod = MODULE_MAP[p.slice(0, idx)];
  return !!mod && (mod.actions as readonly string[]).includes(p.slice(idx + 1));
}
