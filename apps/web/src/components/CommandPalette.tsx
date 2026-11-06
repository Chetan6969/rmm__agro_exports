import { Command } from 'cmdk';
import { Building2, CornerDownLeft, FilePlus2, LayoutGrid, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ENTITIES } from '@rmm/shared';
import { errorMessage } from '../lib/api';
import { NAV } from '../lib/nav';
import { useSession } from '../lib/session';

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

export function CommandPalette({ open, mode, onClose }: { open: boolean; mode: PaletteMode; onClose: () => void }) {
  const { session, can, switchCompany, logout } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) {
      setSearch('');
      document.body.dataset.modalOpen = '1';
      return () => {
        delete document.body.dataset.modalOpen;
      };
    }
  }, [open, mode]);

  if (!open || !session) return null;
  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  const items = NAV.filter((n) => !n.perm || can(n.perm[0], n.perm[1]));
  const groups = [...new Set(items.map((i) => i.group))];
  const creatable = Object.values(ENTITIES).filter((e) => can(`master.${e.key}`, 'create') && (e.scope !== 'group' || session.user.isSuperAdmin));

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
              toast.error(errorMessage(e));
            }
          }}
          className="palette-item"
        >
          <Building2 className="size-4 text-slate-400" />
          <span className="font-mono text-[12px] text-slate-500">{c.code}</span>
          <span>{c.name}</span>
          {c.id === session.activeCompany?.id && <span className="ml-auto text-[11px] text-brand-700">current</span>}
        </Command.Item>
      ))}
    </Command.Group>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <Command
        label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-lg bg-white shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        loop
        filter={paletteFilter}
      >
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder={mode === 'company' ? 'Switch to company…' : 'Go to screen, create record, switch company…'}
          className="w-full border-b border-slate-200 px-4 py-3 text-[15px] outline-none"
        />
        <Command.List className="max-h-[55vh] overflow-y-auto p-1.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-slate-400 [&_[cmdk-group-heading]]:uppercase">
          <Command.Empty className="px-3 py-6 text-center text-slate-500">Nothing found</Command.Empty>
          {mode === 'company' ? (
            companies
          ) : (
            <>
              {groups.map((g) => (
                <Command.Group key={g} heading={g}>
                  {items
                    .filter((i) => i.group === g)
                    .map((i) => (
                      <Command.Item key={i.id} value={i.label} keywords={[i.keywords ?? '', g]} onSelect={() => go(i.path)} className="palette-item">
                        <LayoutGrid className="size-4 text-slate-400" />
                        {i.label}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
              {creatable.length > 0 && (
                <Command.Group heading="Create">
                  {creatable.map((e) => (
                    <Command.Item key={e.key} value={`New ${e.label.toLowerCase()}`} keywords={['create', 'add']} onSelect={() => go(`/m/${e.key}/new`)} className="palette-item">
                      <FilePlus2 className="size-4 text-slate-400" />
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
                  className="palette-item"
                >
                  <LogOut className="size-4 text-slate-400" /> Log out
                </Command.Item>
              </Command.Group>
            </>
          )}
        </Command.List>
        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[11.5px] text-slate-500">
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
        </div>
      </Command>
    </div>
  );
}
