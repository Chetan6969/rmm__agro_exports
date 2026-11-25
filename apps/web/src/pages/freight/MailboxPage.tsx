import { DEFAULT_MAIL_PROVIDER } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, RefreshCw, Send, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '../../components/Modal';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { showError } from '../../lib/notify';
import { fmtWhen, type MailboxInfo } from './types';

interface Form {
  provider: string;
  email: string;
  displayName: string;
  password: string;
}

const SHORT: Record<string, string> = { gmail: 'Google', outlook: 'Microsoft', yahoo: 'Yahoo' };
const HINT: Record<string, string> = { gmail: 'Gmail and company mail on Google Workspace', outlook: 'Outlook, Hotmail, Microsoft 365', yahoo: 'Yahoo Mail' };

/**
 * Each user connects their own mailbox: enquiries go out from it and replies are read from it.
 * Only the provider is chosen; the mail server settings are fixed in the ERP, nothing technical to type.
 */
export function MailboxPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['mail-account'], queryFn: () => api.get<MailboxInfo>('/mail-account') });
  const [f, setF] = useState<Form>({ provider: DEFAULT_MAIL_PROVIDER, email: '', displayName: '', password: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [disconnect, setDisconnect] = useState(false);
  const info = q.data;
  const acc = info?.account ?? null;

  useEffect(() => {
    if (acc) setF({ provider: acc.provider in SHORT ? acc.provider : DEFAULT_MAIL_PROVIDER, email: acc.email, displayName: acc.displayName ?? '', password: '' });
  }, [acc]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const providers = info!.providers;
  const chosen = providers.find((p) => p.provider === f.provider) ?? providers[0];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((o) => ({ ...o, [k]: v }));

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await api.put('/mail-account', { provider: f.provider, email: f.email, displayName: f.displayName || null, password: f.password || undefined });
      set('password', '');
      toast.success('Mailbox connected', { description: 'Sending and receiving both work. Freight enquiries now go out from this address.' });
      await qc.invalidateQueries({ queryKey: ['mail-account'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
      qc.invalidateQueries({ queryKey: ['mail-account'] });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="My mailbox"
        subtitle="Freight enquiries are sent from your own email address, and the replies to them are read back into the ERP automatically."
        actions={<Link to="/freight" className="text-[13px] text-brand-700 hover:underline">Freight quotations →</Link>}
      />
      <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,560px)_1fr]">
        <Card className="p-4">
          {!info!.ready && (
            <div className="mb-3">
              <ErrorBox error={Object.assign(new Error('Email is not set up on this server yet'), { hint: 'An administrator must add MAIL_SECRET_KEY to apps/api/.env and restart the server (see README → Email).' })} />
            </div>
          )}
          {acc && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[13px]">
              {acc.status === 'ok' ? <CheckCircle2 className="size-4 text-brand-700" /> : <Mail className="size-4 text-red-600" />}
              <span className="font-medium">{acc.email}</span>
              <Badge tone={acc.status === 'ok' ? 'green' : 'red'}>{acc.status === 'ok' ? 'Connected' : 'Problem'}</Badge>
              <span className="text-slate-500">Last checked {fmtWhen(acc.lastSyncAt)}</span>
              {acc.lastError && <div className="w-full text-[12.5px] text-red-700">{acc.lastError}</div>}
            </div>
          )}
          <div className="grid gap-3">
            <div className="grid gap-1 text-[12.5px] font-medium text-slate-700">
              Your email is with
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Email provider">
                {providers.map((p) => (
                  <button
                    key={p.provider}
                    type="button"
                    role="radio"
                    aria-checked={f.provider === p.provider}
                    onClick={() => set('provider', p.provider)}
                    className={`rounded border px-2.5 py-2 text-left ${f.provider === p.provider ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/25' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
                  >
                    <span className="block text-[13.5px] font-semibold text-slate-800">{SHORT[p.provider] ?? p.label}</span>
                    <span className="block text-[11.5px] font-normal text-slate-500">{HINT[p.provider] ?? ''}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
              Email address
              <input
                className="field-input"
                type="email"
                autoComplete="email"
                value={f.email}
                onChange={(e) => {
                  const email = e.target.value;
                  // obvious personal addresses pick their provider; company domains keep the choice (Google by default)
                  const domain = email.split('@')[1]?.toLowerCase() ?? '';
                  const hit = providers.find((p) => p.domains.includes(domain));
                  setF((o) => ({ ...o, email, provider: hit?.provider ?? o.provider }));
                }}
                placeholder="you@company.com"
                data-autofocus
              />
            </label>
            <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
              Your name in mails
              <input className="field-input" value={f.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder="e.g. Navneet — RMM Agro Exports" />
            </label>
            <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
              App password
              <input
                className="field-input font-mono"
                type="password"
                autoComplete="new-password"
                value={f.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder={acc ? 'Saved — leave empty to keep it' : 'Paste the app password'}
              />
              <span className="text-[12px] font-normal text-slate-500">
                {chosen.passwordHelp} It is stored encrypted and never shown again.
              </span>
            </label>
            <ErrorBox error={error} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy === 'save'} onClick={save} disabled={!info!.ready || !f.email}>
                {acc ? 'Save and re-check' : 'Connect mailbox'}
              </Button>
              {acc && (
                <>
                  <Button icon={<Send className="size-3.5" />} loading={busy === 'test'} onClick={() => run('test', async () => { const r = await api.post<{ to: string }>('/mail-account/test'); toast.success(`Test mail sent to ${r.to}`); })}>
                    Send test mail
                  </Button>
                  <Button icon={<RefreshCw className="size-3.5" />} loading={busy === 'sync'} onClick={() => run('sync', async () => { const r = await api.post<{ checked: number; matched: number; quotes: number }>('/mail-account/sync'); toast.success(`Checked ${r.checked} new mail(s)`, { description: `${r.matched} reply(ies) to enquiries, ${r.quotes} quote(s) read.` }); })}>
                    Check now
                  </Button>
                  <Button variant="ghost" icon={<Unplug className="size-3.5" />} onClick={() => setDisconnect(true)}>
                    Disconnect
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>
        <Card className="space-y-2 p-4 text-[13px] text-slate-600">
          <h2 className="text-[14px] font-semibold text-slate-800">How it works</h2>
          <ol className="list-decimal space-y-1.5 pl-4">
            <li>Choose Google, Microsoft or Yahoo, then enter your email and an app password once. Company email on Google Workspace counts as Google.</li>
            <li>Create a freight enquiry (or press "Get freight quotes" on a shipment lot) and pick the shipping lines — each gets a personal mail from you.</li>
            <li>Replies come to your normal inbox as usual. The ERP reads them {info!.pollMinutes ? `every ${info!.pollMinutes} minutes` : 'when you press Check now'}, files each one under the right enquiry and reads the rate, free days, transit time and validity.</li>
            <li>Negotiate from the ERP — counter offers go out in the same mail thread. The best offer is ranked on top; book it and the others get a polite regret.</li>
          </ol>
          <p className="text-[12.5px] text-slate-500">Contacts who do not answer get an automatic reminder. Your password is encrypted on the server; only the ERP's mail service can use it.</p>
        </Card>
      </div>
      <ConfirmDialog
        open={disconnect}
        title="Disconnect mailbox?"
        message="The saved app password is removed and replies stop being read. Mails already in the ERP stay."
        confirmLabel="Disconnect"
        onClose={() => setDisconnect(false)}
        onConfirm={async () => {
          await api.del('/mail-account');
          setF({ provider: DEFAULT_MAIL_PROVIDER, email: '', displayName: '', password: '' });
          toast.success('Mailbox disconnected');
          qc.invalidateQueries({ queryKey: ['mail-account'] });
        }}
      />
    </div>
  );
}
