import { ArrowLeft, ChevronRight, House } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Card, Kbd, PageHeader } from '../components/ui';
import { GROUP_ICONS, groupLabel, NAV } from '../lib/nav';
import { useSession } from '../lib/session';

export function HomePage() {
  const { session, can } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  if (!session) return null;
  const items = NAV.filter((n) => n.id !== 'home' && n.group !== 'General' && (!n.perm || can(n.perm[0], n.perm[1])));
  const groups = [...new Set(items.map((i) => i.group))];
  // If the chosen section is gone (e.g. permissions changed), fall back to the overview.
  const active = selected && groups.includes(selected) ? selected : null;
  const subItems = active ? items.filter((i) => i.group === active) : [];

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader
        title={session.activeCompany ? session.activeCompany.name : 'Welcome'}
        subtitle={
          session.activeCompany
            ? `Working in ${session.activeCompany.code}. Everything you create is saved under this company.`
            : session.user.isSuperAdmin
              ? 'No company exists yet. Start by creating your companies.'
              : 'You are not assigned to any company yet. Ask an administrator.'
        }
      />
      <div className="space-y-5 p-5">
        {!session.activeCompany && session.user.isSuperAdmin && (
          <Card className="p-4">
            <p className="mb-2 text-slate-700">First-time setup:</p>
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>
                <Link className="text-brand-700 underline" to="/m/companies/new">
                  Create each company
                </Link>{' '}
                with its letterhead, logo, seal and signature.
              </li>
              <li>
                Open <Link className="text-brand-700 underline" to="/admin/roles">Roles</Link> and adjust the starter roles.
              </li>
              <li>
                Create <Link className="text-brand-700 underline" to="/admin/users">users</Link> and give each one roles per company.
              </li>
              <li>
                Set up <Link className="text-brand-700 underline" to="/admin/numbering">document numbering</Link> and{' '}
                <Link className="text-brand-700 underline" to="/admin/sharing">data sharing</Link> between companies.
              </li>
            </ol>
          </Card>
        )}

        {active ? (
          <div>
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[13px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <ArrowLeft className="size-4" /> All sections
              </button>
              <h2 className="text-[13px] font-semibold text-slate-700">{groupLabel(active)}</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {subItems.map((i) => {
                const Icon = i.icon;
                return (
                  <Link
                    key={i.id}
                    to={i.path}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 shadow-xs transition-colors hover:border-brand-300 hover:bg-brand-50/50"
                  >
                    {Icon && <Icon className="size-4 shrink-0 text-slate-400" />}
                    <span className="truncate">{i.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => {
              const Icon = GROUP_ICONS[g] ?? House;
              const count = items.filter((i) => i.group === g).length;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSelected(g)}
                  className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-xs transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">{groupLabel(g)}</span>
                    <span className="block text-[12.5px] text-slate-500">
                      {count} {count === 1 ? 'screen' : 'screens'}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-500" />
                </button>
              );
            })}
          </div>
        )}

        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-slate-600">
          <span className="font-medium text-slate-700">Keyboard:</span>
          <span>
            <Kbd k="mod+k" /> go anywhere
          </span>
          <span>
            <Kbd k="alt+c" /> switch company
          </span>
          <span>
            <Kbd k="mod+shift+n" /> new in section
          </span>
          <span>
            <Kbd k="mod+s" /> save
          </span>
          <span>
            <Kbd k="f1" /> all shortcuts
          </span>
        </Card>
      </div>
    </div>
  );
}
