import { Building2, Keyboard, LogOut, Menu, PanelLeftOpen, Search } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { SHORTCUTS, useHotkeys } from '../lib/hotkeys';
import { useSession } from '../lib/session';
import { CommandPalette, type PaletteMode } from './CommandPalette';
import { Modal } from './Modal';
import { Sidebar, SIDEBAR_SHORTCUT, useSidebarCollapsed } from './Sidebar';
import { Kbd } from './ui';

export function Layout() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [help, setHelp] = useState(false);
  /** Below the md breakpoint the sidebar is an off-canvas drawer. */
  const [navOpen, setNavOpen] = useState(false);
  const { collapsed, toggle } = useSidebarCollapsed();
  const closeNav = () => setNavOpen(false);
  const isDesktop = () => window.matchMedia('(min-width: 768px)').matches;

  useHotkeys(
    {
      'mod+k': () => setPalette('all'),
      'alt+c': () => setPalette('company'),
      'f1, shift+?': () => setHelp(true),
      'alt+h': () => navigate('/'),
      'alt+l': () => logout(),
      [SIDEBAR_SHORTCUT]: () => (isDesktop() ? toggle() : setNavOpen((o) => !o)),
      // only while the phone drawer is open; otherwise Esc belongs to the page (forms, menus)
      ...(navOpen ? { escape: () => setNavOpen(false) } : {}),
    },
    [navigate, logout, collapsed, navOpen],
  );

  if (!session) return null;

  return (
    <div className="flex h-full">
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/50 md:hidden" aria-hidden="true" onClick={closeNav} />}
      <Sidebar collapsed={collapsed} drawerOpen={navOpen} onToggle={toggle} onCloseDrawer={closeNav} onSwitchCompany={() => setPalette('company')} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid h-12 shrink-0 print:hidden grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-slate-200 bg-white px-2 sm:gap-3 sm:px-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
              aria-label="Open menu"
              aria-controls="main-nav"
              aria-expanded={navOpen}
            >
              <Menu className="size-5" />
            </button>
            {collapsed && (
              <button type="button" onClick={toggle} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 max-md:hidden" title="Expand sidebar" aria-label="Expand sidebar">
                <PanelLeftOpen className="size-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setPalette('all')}
            className="group mx-auto flex w-full max-w-lg min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-slate-400 transition-colors hover:border-slate-300 hover:bg-white"
            aria-label="Search screens, records and actions"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1 truncate text-[13px]">Search screens, buyers, products, PI or invoice no.…</span>
            <span className="max-sm:hidden">
              <Kbd k="mod+k" />
            </span>
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPalette('company')}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-slate-700 hover:bg-slate-100 md:hidden"
              aria-label="Switch company"
            >
              <Building2 className="size-4" /> {session.activeCompany?.code ?? 'Company'}
            </button>
            <button type="button" onClick={() => setHelp(true)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 max-sm:hidden" title="Keyboard shortcuts (F1)">
              <Keyboard className="size-4" />
            </button>
            <span className="max-w-40 truncate px-2 text-[13px] text-slate-600 max-lg:hidden">{session.user.fullName}</span>
            <button type="button" onClick={() => logout()} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" title="Log out (Alt+L)">
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
