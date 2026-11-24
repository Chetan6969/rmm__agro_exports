import { Building2, ChevronDown, ChevronsUpDown, House, PanelLeftClose, PanelLeftOpen, Wheat, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { keyLabel } from '../lib/hotkeys';
import { GROUP_ICONS, groupLabel, NAV, type NavItem } from '../lib/nav';
import { useSession } from '../lib/session';

export const SIDEBAR_SHORTCUT = 'mod+\\';

/** Colour the whole sidebar by the active company (RMM green, Pragati yellow, Dudani blue). */
function companyTone(code?: string): { bar: string; badge: string; panel: string; accent: string } {
  switch ((code ?? '').toUpperCase()) {
    case 'RMM':
      return { bar: 'bg-emerald-500/15 ring-emerald-400/30 hover:bg-emerald-500/25', badge: 'bg-emerald-400/20 text-emerald-200', panel: 'border-emerald-900/60 bg-emerald-950', accent: 'bg-emerald-400' };
    case 'PRAGATI':
      return { bar: 'bg-amber-400/15 ring-amber-300/30 hover:bg-amber-400/25', badge: 'bg-amber-300/25 text-amber-100', panel: 'border-amber-900/60 bg-amber-950', accent: 'bg-amber-300' };
    case 'DUDANI':
      return { bar: 'bg-sky-500/15 ring-sky-400/30 hover:bg-sky-500/25', badge: 'bg-sky-400/20 text-sky-200', panel: 'border-sky-900/60 bg-sky-950', accent: 'bg-sky-400' };
    default:
      return { bar: 'bg-white/5 ring-white/5 hover:bg-white/10', badge: 'bg-amber-300/15 text-amber-200', panel: 'border-slate-800 bg-slate-900', accent: 'bg-amber-300' };
  }
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode: the preference is simply not remembered */
  }
};

/** Collapsed state of the desktop sidebar, remembered per browser. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => read('nav.collapsed', false));
  const toggle = () =>
    setCollapsed((c) => {
      write('nav.collapsed', !c);
      return !c;
    });
  return { collapsed, toggle };
}

const isActive = (item: NavItem, path: string) => (item.path === '/' ? path === '/' : path === item.path || path.startsWith(`${item.path}/`));

/**
 * Main navigation.
 * Desktop: full sidebar with collapsible sections, or a slim icon rail (Ctrl+\) whose icons open a flyout.
 * Phone/tablet: off-canvas drawer (always full).
 */
export function Sidebar({
  collapsed,
  drawerOpen,
  onToggle,
  onCloseDrawer,
  onSwitchCompany,
}: {
  collapsed: boolean;
  drawerOpen: boolean;
  onToggle: () => void;
  onCloseDrawer: () => void;
  onSwitchCompany: () => void;
}) {
  const { session, can } = useSession();
  const { pathname } = useLocation();
  const items = NAV.filter((n) => !n.perm || can(n.perm[0], n.perm[1]));
  const groups = [...new Set(items.map((i) => i.group))].filter((g) => g !== 'General');
  const activeGroup = items.find((i) => isActive(i, pathname))?.group;

  const [open, setOpen] = useState<Record<string, boolean>>(() => read('nav.groups', { Sales: true }));
  // the section holding the current screen always opens
  useEffect(() => {
    if (activeGroup && !open[activeGroup]) setOpen((o) => ({ ...o, [activeGroup]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);
  const toggleGroup = (g: string) =>
    setOpen((o) => {
      const n = { ...o, [g]: !o[g] };
      write('nav.groups', n);
      return n;
    });

  const [flyout, setFlyout] = useState<{ group: string; top: number } | null>(null);
  useEffect(() => setFlyout(null), [pathname, collapsed]);

  if (!session) return null;
  const home = items.find((i) => i.id === 'home')!;
  const HomeIcon = home.icon ?? House;
  const rail = collapsed && !drawerOpen;
  const shortcut = keyLabel(SIDEBAR_SHORTCUT);

  const link = (i: NavItem, nested: boolean) => {
    const Icon = i.icon;
    return (
      <NavLink
        key={i.id}
        to={i.path}
        end={i.path === '/'}
        onClick={onCloseDrawer}
        className={({ isActive: a }) =>
          `group/link relative flex items-center gap-2.5 rounded-md py-1.5 pr-2 text-[13px] transition-colors ${nested ? 'pl-8' : 'pl-2.5'} ${
            a ? 'bg-white/10 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
          }`
        }
      >
        {({ isActive: a }) => (
          <>
            {a && <span className={`absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r ${companyTone(session.activeCompany?.code).accent}`} aria-hidden />}
            {Icon && !nested && <Icon className="size-4 shrink-0" />}
            <span className="truncate">{i.label}</span>
          </>
        )}
      </NavLink>
    );
  };

  return (
    <aside
      id="main-nav"
      aria-label="Main navigation"
      className={`flex shrink-0 flex-col border-r ${companyTone(session.activeCompany?.code).panel} text-slate-300 transition-[width] duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72 max-md:shadow-2xl max-md:transition-transform ${
        drawerOpen ? '' : 'max-md:-translate-x-full'
      } ${rail ? 'md:w-[60px]' : 'md:w-60'}`}
    >
      {/* brand + collapse */}
      <div className={`flex h-12 items-center gap-2 border-b border-white/5 ${rail ? 'justify-center px-0' : 'px-3'}`}>
        {!rail && (
          <>
            <span className="flex size-7 items-center justify-center rounded-md bg-amber-300/15">
              <Wheat className="size-4 text-amber-300" />
            </span>
            <span className="flex-1 truncate text-[14px] font-semibold tracking-tight text-white">Export ERP</span>
          </>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white max-md:hidden"
          title={`${rail ? 'Expand' : 'Collapse'} sidebar (${shortcut})`}
          aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!rail}
          aria-controls="main-nav"
        >
          {rail ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
        <button type="button" onClick={onCloseDrawer} className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 md:hidden" aria-label="Close menu">
          <X className="size-4" />
        </button>
      </div>

      {/* company */}
      <div className={rail ? 'flex justify-center py-2' : 'p-2'}>
        {rail ? (
          <button
            type="button"
            onClick={onSwitchCompany}
            className={`flex size-9 items-center justify-center rounded-md font-mono text-[11px] font-semibold hover:brightness-125 ${companyTone(session.activeCompany?.code).badge}`}
            title={`${session.activeCompany?.name ?? 'No company selected'} — switch company (Alt+C)`}
            aria-label="Switch company"
          >
            {session.activeCompany?.code.slice(0, 3) ?? <Building2 className="size-4" />}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              onCloseDrawer();
              onSwitchCompany();
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ring-1 ${companyTone(session.activeCompany?.code).bar}`}
            title="Switch company (Alt+C)"
          >
            <span className={`flex size-7 shrink-0 items-center justify-center rounded font-mono text-[10.5px] font-semibold ${companyTone(session.activeCompany?.code).badge}`}>
              {session.activeCompany?.code.slice(0, 3) ?? <Building2 className="size-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{session.activeCompany?.name ?? 'No company selected'}</span>
              <span className="block text-[11px] text-slate-500">Switch · Alt+C</span>
            </span>
            <ChevronsUpDown className="size-3.5 text-slate-500" />
          </button>
        )}
      </div>

      {/* sections */}
      <nav className={`flex-1 overflow-y-auto pb-3 ${rail ? 'px-0' : 'px-2'}`} aria-label="Main">
        {rail ? (
          <ul className="flex flex-col items-center gap-1 pt-1">
            <li>
              <NavLink
                to="/"
                end
                title="Home (Alt+H)"
                aria-label="Home"
                className={({ isActive: a }) => `flex size-10 items-center justify-center rounded-md ${a ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
              >
                <HomeIcon className="size-[18px]" />
              </NavLink>
            </li>
            {groups.map((g) => {
              const Icon = GROUP_ICONS[g];
              const here = g === activeGroup;
              return (
                <li key={g}>
                  <button
                    type="button"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setFlyout((f) => (f?.group === g ? null : { group: g, top: r.top }));
                    }}
                    className={`relative flex size-10 items-center justify-center rounded-md ${here || flyout?.group === g ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    title={groupLabel(g)}
                    aria-label={groupLabel(g)}
                    aria-haspopup="menu"
                    aria-expanded={flyout?.group === g}
                  >
                    {here && <span className={`absolute top-2 bottom-2 left-0 w-[3px] rounded-r ${companyTone(session.activeCompany?.code).accent}`} aria-hidden />}
                    {Icon && <Icon className="size-[18px]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <>
            <div className="pt-1">{link(home, false)}</div>
            {groups.map((g, idx) => {
              const Icon = GROUP_ICONS[g];
              const isOpen = !!open[g];
              const firstMaster = g.startsWith('Masters') && !groups[idx - 1]?.startsWith('Masters');
              const sectionItems = items.filter((i) => i.group === g);
              return (
                <div key={g}>
                  {firstMaster && <div className="mt-4 mb-1 px-2.5 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">Masters</div>}
                  <button
                    type="button"
                    onClick={() => toggleGroup(g)}
                    aria-expanded={isOpen}
                    className={`mt-0.5 flex w-full items-center gap-2.5 rounded-md py-1.5 pr-2 pl-2.5 text-left text-[13px] ${
                      g === activeGroup && !isOpen ? 'text-white' : 'text-slate-300'
                    } hover:bg-white/5 hover:text-white ${!firstMaster && !g.startsWith('Masters') ? 'mt-3' : ''}`}
                  >
                    {Icon && <Icon className="size-4 shrink-0 text-slate-400" />}
                    <span className="flex-1 truncate font-medium">{groupLabel(g)}</span>
                    {!isOpen && <span className="text-[11px] text-slate-500 tabular-nums">{sectionItems.length}</span>}
                    <ChevronDown className={`size-3.5 text-slate-500 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </button>
                  {isOpen && <div className="relative mt-0.5 space-y-px before:absolute before:top-1 before:bottom-1 before:left-[17px] before:w-px before:bg-white/10">{sectionItems.map((i) => link(i, true))}</div>}
                </div>
              );
            })}
          </>
        )}
      </nav>

      {!rail && <div className="border-t border-white/5 px-3 py-2 text-[11px] text-slate-500 max-md:hidden">Collapse with {shortcut}</div>}

      {rail && flyout && (
        <Flyout group={flyout.group} top={flyout.top} items={items.filter((i) => i.group === flyout.group)} pathname={pathname} onClose={() => setFlyout(null)} />
      )}
    </aside>
  );
}

/** Menu of one section, shown beside the collapsed rail. */
function Flyout({ group, top, items, pathname, onClose }: { group: string; top: number; items: NavItem[]; pathname: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(top);
  // keep the menu on screen
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setY(Math.max(8, Math.min(top, window.innerHeight - h - 8)));
    ref.current?.querySelector<HTMLElement>('a')?.focus();
  }, [top, group]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[aria-haspopup="menu"]')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={groupLabel(group)}
      style={{ top: y }}
      className="fixed left-[64px] z-50 w-60 rounded-lg border border-slate-700 bg-slate-900 p-1.5 shadow-2xl"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const links = [...(ref.current?.querySelectorAll<HTMLElement>('a') ?? [])];
        const i = links.indexOf(document.activeElement as HTMLElement);
        links[(i + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length]?.focus();
      }}
    >
      <div className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">{groupLabel(group)}</div>
      {items.map((i) => {
        const Icon = i.icon;
        const a = isActive(i, pathname);
        return (
          <NavLink
            key={i.id}
            to={i.path}
            role="menuitem"
            onClick={onClose}
            className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] outline-none ${a ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white focus:bg-white/10 focus:text-white'}`}
          >
            {Icon && <Icon className="size-4 shrink-0 text-slate-400" />}
            <span className="truncate">{i.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}
