import { DOC_LIST, ENTITIES } from '@rmm/shared';
import { useQueries } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Building2, Clock, CornerDownLeft, FilePlus2, Loader2, LogOut, type LucideIcon, Package, Search, Truck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, qs } from '../lib/api';
import { GROUP_ICONS, groupLabel, NAV } from '../lib/nav';
import { showError } from '../lib/notify';
import { useSession } from '../lib/session';
import { useDebounced } from '../pages/MasterListPage';

export type PaletteMode = 'all' | 'company';

/**
 * Predictable matching: every typed word must appear in the item's label or keywords.
 * Label prefix > label substring > keyword match. (cmdk's default fuzzy match ranks
 * "Bank accounts" above "Customers" for "customers".)
 */
function paletteFilter(value: string, search: string, keywords?: string[]) {
  const q = search.toLowerCase().trim();
  if (!q) return 1;
  const label = value.toLowerCase();
  const hay = `${label} ${(keywords ?? []).join(' ').toLowerCase()}`;
  if (!q.split(/\s+/).every((w) => hay.includes(w))) return 0;
  if (label.startsWith(q) || label.split(/[\s/]+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 0.8;
  return 0.4;
}

interface Recent {
  path: string;
  label: string;
  kind: string;
}
const RECENT_KEY = 'palette.recent';
const readRecent = (): Recent[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
  } catch {
    return [];
  }
};
const pushRecent = (r: Recent) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([r, ...readRecent().filter((x) => x.path !== r.path)].slice(0, 6)));
  } catch {
    /* not remembered in private mode */
  }
};

interface Option {
  id: string;
  label: string;
  sub?: string;
}

/** Records searched live from the palette (each only when the user may view it). */
const RECORD_SOURCES: { key: string; kind: string; url: string; path: string; perm: string; icon: LucideIcon }[] = [
  ...DOC_LIST.map((d) => ({ key: d.key, kind: d.label, url: `/documents/${d.key}/lookup`, path: `/d/${d.key}`, perm: d.module, icon: GROUP_ICONS.Sales })),
  { key: 'customers', kind: 'Buyer', url: '/masters/customers/lookup', path: '/m/customers', perm: 'master.customers', icon: Users },
  { key: 'suppliers', kind: 'Supplier', url: '/masters/suppliers/lookup', path: '/m/suppliers', perm: 'master.suppliers', icon: Truck },
  { key: 'products', kind: 'Product', url: '/masters/products/lookup', path: '/m/products', perm: 'master.products', icon: Package },
];

const itemClass = 'palette-item';

/** Spotlight-style search in the middle of the screen: screens, records, actions, companies. */
export function CommandPalette({ open, mode, onClose }: { open: boolean; mode: PaletteMode; onClose: () => void }) {
  const { session, can, switchCompany, logout } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 200);

  useEffect(() => {
    if (open) {
      setSearch('');
      document.body.dataset.modalOpen = '1';
      return () => {
        delete document.body.dataset.modalOpen;
      };
    }
  }, [open, mode]);

  const sources = RECORD_SOURCES.filter((s) => can(s.perm, 'view'));
  const searching = open && mode === 'all' && term.length >= 2 && !!session?.activeCompany;
  const results = useQueries({
    queries: sources.map((s) => ({
      queryKey: ['palette', s.key, term],
      queryFn: () => api.get<Option[]>(`${s.url}${qs({ q: term, limit: 5 })}`),
      enabled: searching,
      staleTime: 30_000,
    })),
  });

  if (!open || !session) return null;
  const go = (path: string, label: string, kind: string) => {
    pushRecent({ path, label, kind });
    onClose();
    navigate(path);
  };
  const items = NAV.filter((n) => !n.perm || can(n.perm[0], n.perm[1]));
  const groups = [...new Set(items.map((i) => i.group))];
  const creatable = [
    ...DOC_LIST.filter((d) => can(d.module, 'create')).map((d) => ({ key: d.key, label: d.label, path: `/d/${d.key}/new` })),
    ...Object.values(ENTITIES)
      .filter((e) => can(`master.${e.key}`, 'create') && (e.scope !== 'group' || session.user.isSuperAdmin))
      .map((e) => ({ key: e.key, label: e.label, path: `/m/${e.key}/new` })),
  ];
  const recent = readRecent();
  const loading = searching && results.some((r) => r.isFetching);
  const found = sources.map((s, i) => ({ s, rows: (results[i]?.data ?? []).slice(0, 5) })).filter((x) => searching && x.rows.length);

  const companies = (
    <Command.Group heading="Switch company">
      {session.companies.map((c) => (
        <Command.Item
          key={c.id}
          value={`${c.code} ${c.name}`}
          keywords={['company', 'switch']}
          onSelect={async () => {
            onClose();
            if (c.id === session.activeCompany?.id) return;
            try {
              await switchCompany(c.id);
              toast.success(`Now working in ${c.name}`);
              navigate('/');
            } catch (e) {
              showError(e);
            }
          }}
          className={itemClass}
        >
          <Icon icon={Building2} />
          <span className="font-mono text-[12px] text-slate-500">{c.code}</span>
          <span>{c.name}</span>
          {c.id === session.activeCompany?.id && <span className="ml-auto text-[11px] text-brand-700">current</span>}
        </Command.Item>
      ))}
    </Command.Group>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/25 p-4 pt-[14vh] backdrop-blur-[3px] sm:pt-[18vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <Command
        label={mode === 'company' ? 'Switch company' : 'Search'}
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white/95 shadow-[0_24px_80px_-12px_rgba(15,23,42,0.45)] ring-1 ring-slate-900/10 backdrop-blur-xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        loop
        filter={paletteFilter}
      >
        <div className="flex items-center gap-3 border-b border-slate-200/80 px-4">
          {loading ? <Loader2 className="size-5 shrink-0 animate-spin text-slate-400" /> : <Search className="size-5 shrink-0 text-slate-400" />}
          <Command.Input
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={mode === 'company' ? 'Switch to company…' : 'Search screens, buyers, products, PI / invoice no., actions…'}
            className="h-14 w-full bg-transparent text-[17px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="kbd shrink-0 max-sm:hidden">Esc</kbd>
        </div>
        <Command.List className="max-h-[52vh] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-slate-400 [&_[cmdk-group-heading]]:uppercase">
          <Command.Empty className="px-3 py-8 text-center text-[13px] text-slate-500">
            {loading ? 'Searching…' : search.trim().length === 1 ? 'Type one more letter to search records' : `Nothing found for “${search}”`}
          </Command.Empty>
          {mode === 'company' ? (
            companies
          ) : (
            <>
              {!search && recent.length > 0 && (
                <Command.Group heading="Recent">
                  {recent.map((r) => (
                    <Command.Item key={r.path} value={`recent ${r.label}`} onSelect={() => go(r.path, r.label, r.kind)} className={itemClass}>
                      <Icon icon={Clock} />
                      <span className="truncate">{r.label}</span>
                      <span className="ml-auto text-[11.5px] text-slate-400">{r.kind}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {found.map(({ s, rows }) => (
                <Command.Group key={s.key} heading={s.kind === 'Buyer' ? 'Buyers' : s.kind === 'Supplier' ? 'Suppliers' : s.kind === 'Product' ? 'Products' : `${s.kind}s`}>
                  {rows.map((r) => (
                    <Command.Item
                      key={r.id}
                      value={`${r.label}​${s.key}${r.id}`}
                      keywords={[search, r.sub ?? '']}
                      onSelect={() => go(`${s.path}/${r.id}`, r.label, s.kind)}
                      className={itemClass}
                    >
                      <Icon icon={s.icon} tone="blue" />
                      <span className="truncate font-medium">{r.label}</span>
                      {r.sub && <span className="truncate text-[12px] text-slate-400">{r.sub}</span>}
                      <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10.5px] text-slate-500">{s.kind}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {groups.map((g) => (
                <Command.Group key={g} heading={g === 'General' ? 'Go to' : groupLabel(g)}>
                  {items
                    .filter((i) => i.group === g)
                    .map((i) => (
                      <Command.Item key={i.id} value={i.label} keywords={[i.keywords ?? '', g]} onSelect={() => go(i.path, i.label, 'Screen')} className={itemClass}>
                        <Icon icon={i.icon ?? GROUP_ICONS[g] ?? Search} />
                        {i.label}
                        <span className="ml-auto text-[11.5px] text-slate-400">{g === 'General' ? '' : groupLabel(g)}</span>
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
              {creatable.length > 0 && (
                <Command.Group heading="Create">
                  {creatable.map((e) => (
                    <Command.Item key={e.key} value={`New ${e.label.toLowerCase()}`} keywords={['create', 'add']} onSelect={() => go(e.path, `New ${e.label.toLowerCase()}`, 'Create')} className={itemClass}>
                      <Icon icon={FilePlus2} tone="green" />
                      New {e.label.toLowerCase()}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {search && companies}
              <Command.Group heading="Session">
                <Command.Item
                  value="Log out"
                  keywords={['sign out', 'logout']}
                  onSelect={async () => {
                    onClose();
                    await logout();
                  }}
                  className={itemClass}
                >
                  <Icon icon={LogOut} /> Log out
                </Command.Item>
              </Command.Group>
            </>
          )}
        </Command.List>
        <div className="flex items-center gap-4 border-t border-slate-200/80 bg-slate-50/80 px-4 py-2 text-[11.5px] text-slate-500">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="kbd">
              <CornerDownLeft className="size-3" />
            </kbd>{' '}
            open
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> close
          </span>
          {mode === 'all' && <span className="ml-auto max-sm:hidden">Type 2+ letters to search records</span>}
        </div>
      </Command>
    </div>
  );
}

function Icon({ icon: I, tone = 'slate' }: { icon: LucideIcon; tone?: 'slate' | 'blue' | 'green' }) {
  const tones = { slate: 'bg-slate-100 text-slate-500', blue: 'bg-sky-50 text-sky-700', green: 'bg-brand-50 text-brand-700' };
  return (
    <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${tones[tone]}`}>
      <I className="size-4" />
    </span>
  );
}
