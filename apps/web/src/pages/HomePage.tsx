import { Link } from 'react-router';
import { Card, Kbd, PageHeader } from '../components/ui';
import { NAV } from '../lib/nav';
import { useSession } from '../lib/session';

export function HomePage() {
  const { session, can } = useSession();
  if (!session) return null;
  const items = NAV.filter((n) => n.id !== 'home' && (!n.perm || can(n.perm[0], n.perm[1])));
  const groups = [...new Set(items.map((i) => i.group))];

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

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Card key={g} className="p-3">
              <h2 className="mb-2 text-[11.5px] font-semibold tracking-wide text-slate-500 uppercase">{g}</h2>
              <ul className="space-y-0.5">
                {items
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <li key={i.id}>
                      <Link to={i.path} className="block rounded px-2 py-1 hover:bg-slate-100">
                        {i.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>

        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-slate-600">
          <span className="font-medium text-slate-700">Keyboard:</span>
          <span>
            <Kbd k="mod+k" /> go anywhere
          </span>
          <span>
            <Kbd k="alt+c" /> switch company
          </span>
          <span>
            <Kbd k="alt+n" /> new record
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
