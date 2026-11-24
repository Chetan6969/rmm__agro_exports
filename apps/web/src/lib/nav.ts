import { DOC_LIST, ENTITY_LIST, MENU_ORDER, type Action, type EntityDef } from '@rmm/shared';
import {
  Banknote,
  BarChart3,
  Boxes,
  Building2,
  Factory,
  FileBarChart2,
  FileCheck2,
  FileSignature,
  FileText,
  Globe2,
  Hash,
  History,
  House,
  Landmark,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PackageCheck,
  Receipt,
  ScrollText,
  Share2,
  Shield,
  ShieldCheck,
  Ship,
  Users,
  UserCog,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  group: string;
  perm?: [string, Action];
  keywords?: string;
  icon?: LucideIcon;
}

const entities = ENTITY_LIST as readonly EntityDef[];

const DOC_ICONS: Record<string, LucideIcon> = { proformaInvoices: FileSignature, productionOrders: Factory, commercialInvoices: Receipt };

/** Every screen in one list: drives the sidebar and the command palette. */
export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', path: '/', group: 'General', icon: House },
  { id: 'mis', label: 'Export overview', path: '/mis', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'dashboard analytics graphs payments receivables pending received orders kpi', icon: LayoutDashboard },
  { id: 'mis-trade', label: 'Trade analytics', path: '/mis/trade', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'country destination port incoterm market export', icon: Globe2 },
  { id: 'mis-buyers', label: 'Buyers', path: '/mis/buyers', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'customer buyer intelligence repeat outstanding aov', icon: Users },
  { id: 'mis-orders', label: 'Orders & contracts', path: '/mis/orders', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'proforma order contract fulfilment executed value', icon: PackageCheck },
  { id: 'mis-logistics', label: 'Logistics', path: '/mis/logistics', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'shipment vessel bl container pipeline freight charges', icon: Ship },
  { id: 'mis-financial', label: 'Financial & forex', path: '/mis/financial', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'currency forex lc exchange rate received pending revenue', icon: Banknote },
  { id: 'mis-products', label: 'Product analytics', path: '/mis/products', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'variety grade processing crop year product volume', icon: Boxes },
  { id: 'mis-docs', label: 'Documentation', path: '/mis/documentation', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'compliance certificate checklist documents obl', icon: FileCheck2 },
  { id: 'mis-reports', label: 'Custom reports', path: '/mis/reports', group: 'MIS', perm: ['mis.dashboard', 'view'], keywords: 'report export csv dataset builder', icon: FileBarChart2 },
  ...DOC_LIST.map((d) => ({
    id: `d-${d.key}`,
    label: d.plural,
    path: `/d/${d.key}`,
    group: 'Sales',
    perm: [d.module, 'view'] as [string, Action],
    keywords: `${d.label} ${d.short} sales document`,
    icon: DOC_ICONS[d.key] ?? FileText,
  })),
  { id: 'shipments', label: 'Shipments', path: '/shipments', group: 'Sales', perm: ['sales.shipments', 'view'], keywords: 'lots order planning shipment charges gulf eu', icon: Ship },
  { id: 'pi-reports', label: 'PI reports', path: '/reports/proforma', group: 'Sales', perm: ['sales.proformaInvoices', 'view'], keywords: 'proforma analysis field usage terms', icon: BarChart3 },
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
  { id: 'users', label: 'Users', path: '/admin/users', group: 'Administration', perm: ['admin.users', 'view'], keywords: 'staff login access', icon: UserCog },
  { id: 'roles', label: 'Roles & permissions', path: '/admin/roles', group: 'Administration', perm: ['admin.roles', 'view'], keywords: 'rbac rights', icon: ShieldCheck },
  { id: 'sharing', label: 'Data sharing', path: '/admin/sharing', group: 'Administration', perm: ['admin.sharing', 'view'], keywords: 'share companies policy', icon: Share2 },
  { id: 'numbering', label: 'Document numbering', path: '/admin/numbering', group: 'Administration', perm: ['admin.numbering', 'view'], keywords: 'series invoice number fy', icon: Hash },
  { id: 'audit', label: 'Audit log', path: '/admin/audit', group: 'Administration', perm: ['admin.audit', 'view'], keywords: 'history changes who', icon: History },
];

/** Icon for each sidebar section (also used in the collapsed rail). */
export const GROUP_ICONS: Record<string, LucideIcon> = {
  General: House,
  MIS: LayoutDashboard,
  Sales: Receipt,
  'Masters · Company': Building2,
  'Masters · Parties': Users,
  'Masters · Products': Package,
  'Masters · Logistics': Ship,
  'Masters · Finance': Landmark,
  'Masters · General': ScrollText,
  Administration: Shield,
};

/** Short section names for the rail flyout and headings ("Masters · Parties" → "Parties"). */
export const groupLabel = (g: string) => g.replace(/^Masters · /, '');
