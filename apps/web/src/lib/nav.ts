import { ENTITY_LIST, MENU_ORDER, type EntityDef } from '@rmm/shared';
import type { Action } from '@rmm/shared';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  group: string;
  perm?: [string, Action];
  keywords?: string;
}

const entities = ENTITY_LIST as readonly EntityDef[];

/** Every screen in one list: drives the sidebar and the command palette. */
export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', path: '/', group: 'General' },
  ...MENU_ORDER.flatMap((menu) =>
    entities
      .filter((e) => e.menu === menu)
      .map((e) => ({
        id: `m-${e.key}`,
        label: e.plural,
        path: `/m/${e.key}`,
        group: `Masters · ${menu}`,
        perm: [`master.${e.key}`, 'view'] as [string, Action],
        keywords: `${e.label} master ${e.table}`,
      })),
  ),
  { id: 'users', label: 'Users', path: '/admin/users', group: 'Administration', perm: ['admin.users', 'view'], keywords: 'staff login access' },
  { id: 'roles', label: 'Roles & permissions', path: '/admin/roles', group: 'Administration', perm: ['admin.roles', 'view'], keywords: 'rbac rights' },
  { id: 'sharing', label: 'Data sharing', path: '/admin/sharing', group: 'Administration', perm: ['admin.sharing', 'view'], keywords: 'share companies policy' },
  { id: 'numbering', label: 'Document numbering', path: '/admin/numbering', group: 'Administration', perm: ['admin.numbering', 'view'], keywords: 'series invoice number fy' },
  { id: 'audit', label: 'Audit log', path: '/admin/audit', group: 'Administration', perm: ['admin.audit', 'view'], keywords: 'history changes who' },
];
