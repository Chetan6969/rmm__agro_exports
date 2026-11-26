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
  ListChecks,
  LayoutDashboard,
  Contact,
  Inbox,
  Radar,
  ShoppingCart,
  Workflow,
  FilePlus2,
  Mail,
  MailSearch,
  type LucideIcon,
  Package,
  PackageCheck,
  Receipt,
  ScrollText,
  Share2,
  Shield,
  ShieldCheck,
  Ship,
  Trash2,
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

/** The freight quotation section and the masters that live in it (not under Masters). */
export const FREIGHT = 'Freight quotations';
export const FLOW = 'Export flow';
const FREIGHT_MASTERS = ['freightContacts', 'mailTemplates'];

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
  { id: 'shipments', label: 'Shipments', path: '/shipments', group: 'Sales', perm: ['sales.shipments', 'view'], keywords: 'lots order planning shipment charges gulf eu staging stage board checkpoints overdue', icon: Ship },
  { id: 'pi-reports', label: 'PI reports', path: '/reports/proforma', group: 'Sales', perm: ['sales.proformaInvoices', 'view'], keywords: 'proforma analysis field usage terms', icon: BarChart3 },
  // Export flow: documents in, lots tracked, packaging bought
  { id: 'inbox', label: 'Document inbox', path: '/inbox', group: FLOW, perm: ['sales.intake', 'view'], keywords: 'upload scan ocr read po contract bl lading shipping bill phyto fumigation coo certificate invoice pdf excel extract', icon: Inbox },
  { id: 'tracker', label: 'Shipment tracker', path: '/tracker', group: FLOW, perm: ['sales.shipments', 'view'], keywords: 'track sheet bl status eta vessel booking lc payment documents checklist lots', icon: Radar },
  { id: 'vendor-pos', label: 'Packaging POs', path: '/vendor-pos', group: FLOW, perm: ['sales.vendorPos', 'view'], keywords: 'purchase order packaging bags jute tags strips seals supplier vendor', icon: ShoppingCart },
  // Freight quotations: everything for asking, comparing and booking ocean freight, in one section
  { id: 'freight', label: 'Enquiries', path: '/freight', group: FREIGHT, perm: ['sales.freight', 'view'], keywords: 'freight rate quote quotation shipping line email mail negotiation booking ocean carrier compare best enquiry', icon: MailSearch },
  { id: 'freight-new', label: 'New enquiry', path: '/freight/new', group: FREIGHT, perm: ['sales.freight', 'create'], keywords: 'freight rate request quotation new ask shipping lines', icon: FilePlus2 },
  { id: 'mailbox', label: 'My mailbox', path: '/freight/mailbox', group: FREIGHT, perm: ['sales.freight', 'view'], keywords: 'email smtp imap app password gmail outlook microsoft yahoo connect mail account', icon: Mail },
  ...FREIGHT_MASTERS.map((key) => {
    const e = entities.find((x) => x.key === key)!;
    return { id: `m-${key}`, label: e.plural, path: `/m/${key}`, group: FREIGHT, perm: [`master.${key}`, 'view'] as [string, Action], keywords: `${e.label} master freight quotation`, icon: key === 'freightContacts' ? Contact : FileText };
  }),
  ...MENU_ORDER.flatMap((menu) =>
    entities
      .filter((e) => e.menu === menu && !FREIGHT_MASTERS.includes(e.key))
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
  { id: 'recycle-bin', label: 'Recycle bin', path: '/recycle-bin', group: 'Administration', keywords: 'deleted trash restore undo bin removed', icon: Trash2 },
  { id: 'checkpoints', label: 'Shipment checkpoints', path: '/admin/checkpoints', group: 'Administration', perm: ['admin.pipeline', 'view'], keywords: 'staging stage pipeline checkpoint path sla due overdue', icon: ListChecks },
  { id: 'audit', label: 'Audit log', path: '/admin/audit', group: 'Administration', perm: ['admin.audit', 'view'], keywords: 'history changes who', icon: History },
];

/** Icon for each sidebar section (also used in the collapsed rail). */
export const GROUP_ICONS: Record<string, LucideIcon> = {
  General: House,
  MIS: LayoutDashboard,
  Sales: Receipt,
  [FLOW]: Workflow,
  [FREIGHT]: MailSearch,
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
