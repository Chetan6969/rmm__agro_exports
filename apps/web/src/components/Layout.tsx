import { Building2, ChevronsUpDown, Command as CmdIcon, Keyboard, LogOut, Menu, Wheat, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { SHORTCUTS, useHotkeys } from '../lib/hotkeys';
import { NAV } from '../lib/nav';
import { useSession } from '../lib/session';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { Modal } from './Modal';
import { Kbd } from './ui';

export function Layout() {
  const { session, can, logout } = useSession();
  const navigate = useNavigate();
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [help, setHelp] = useState(false);
  /** Below the md breakpoint the sidebar is an off-canvas drawer. */
  const [navOpen, setNavOpen] = useState(false);
  const closeNav = () => setNavOpen(false);

  useHotkeys(
    {
      'mod+k, mod+p': () => setPalette('all'),
      'alt+c': () => setPalette('company'),
      'f1, shift+?': () => setHelp(true),
      'alt+h': () => navigate('/'),
      'alt+l': () => logout(),
      escape: () => setNavOpen(false),
    },
    [navigate, logout],
  );

  if (!session) return null;
  const items = NAV.filter((n) => !n.perm || can(n.perm[0], n.perm[1]));
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="flex h-full">
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/50 md:hidden" aria-hidden="true" onClick={closeNav} />}
      <aside
        id="main-nav"
        className={`flex w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-300 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-64 max-md:shadow-2xl max-md:transition-transform ${navOpen ? '' : 'max-md:-translate-x-full'}`}
      >
        <div className="flex items-center gap-2 px-4 py-3 text-white">
          <Wheat className="size-5 text-amber-300" />
          <span className="flex-1 font-semibold tracking-tight">Export ERP</span>
          <button type="button" onClick={closeNav} className="rounded p-1 text-slate-400 hover:bg-slate-800 md:hidden" aria-label="Close menu">
            <X className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            closeNav();
            setPalette('company');
          }}
          className="mx-2 mb-2 flex items-center gap-2 rounded bg-slate-800 px-2.5 py-2 text-left hover:bg-slate-700"
          title="Switch company (Alt+C)"
        >
          <Building2 className="size-4 shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">{session.activeCompany?.name ?? 'No company selected'}</span>
            <span className="block text-[11px] text-slate-400">{session.activeCompany?.code ?? 'Alt+C to choose'}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-slate-500" />
        </button>
        <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="mt-3">
              <div className="px-2 pb-1 text-[10.5px] font-semibold tracking-wider text-slate-500 uppercase">{g}</div>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <NavLink
                    key={i.id}
                    to={i.path}
                    end={i.path === '/'}
                    onClick={closeNav}
                    className={({ isActive }) =>
                      `block truncate rounded px-2 py-1 text-[13px] ${isActive ? 'bg-brand-700 text-white' : 'hover:bg-slate-800 hover:text-white'}`
                    }
                  >
                    {i.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label="Open menu"
            aria-controls="main-nav"
            aria-expanded={navOpen}
          >
            <Menu className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setPalette('all')}
            className="flex min-w-0 flex-1 items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-left text-slate-400 hover:border-slate-300 sm:max-w-md"
            aria-label="Search screens and actions"
          >
            <CmdIcon className="size-3.5 shrink-0" />
            <span className="flex-1 truncate text-[13px]">Search…</span>
            <span className="max-sm:hidden">
              <Kbd k="mod+k" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPalette('company')}
            className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[13px] font-medium md:hidden"
            aria-label="Switch company"
          >
            <Building2 className="size-4" /> {session.activeCompany?.code ?? 'Company'}
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setHelp(true)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 max-sm:hidden" title="Keyboard shortcuts (F1)">
              <Keyboard className="size-4" />
            </button>
            <span className="max-w-40 truncate px-2 text-[13px] text-slate-600 max-sm:hidden">{session.user.fullName}</span>
            <button type="button" onClick={() => logout()} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Log out (Alt+L)">
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={palette !== null} mode={palette ?? 'all'} onClose={() => setPalette(null)} />
      <Modal open={help} title="Keyboard shortcuts" onClose={() => setHelp(false)} width="max-w-2xl">
        <div className="grid gap-5 sm:grid-cols-2">
          {SHORTCUTS.map((s) => (
            <div key={s.section}>
              <h3 className="mb-1.5 text-[12px] font-semibold tracking-wide text-slate-500 uppercase">{s.section}</h3>
              <table className="w-full">
                <tbody>
                  {s.items.map(([k, d]) => (
                    <tr key={k + d} className="align-top">
                      <td className="py-1 pr-3 whitespace-nowrap">
                        <Kbd k={k} />
                      </td>
                      <td className="py-1 text-slate-700">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
