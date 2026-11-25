import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Mail, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';
import { ENQUIRY_TONE, fmtDate, label, type EnquiryRow, type MailboxInfo } from './types';

const STATUSES = ['', 'OPEN', 'AWARDED', 'CLOSED', 'CANCELLED'];

export function MailboxBanner() {
  const q = useQuery({ queryKey: ['mail-account'], queryFn: () => api.get<MailboxInfo>('/mail-account') });
  const a = q.data?.account;
  if (!q.data || (a && a.status === 'ok')) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800 sm:px-5">
      <Mail className="size-4" />
      {a ? `Your mailbox ${a.email} has a problem: ${a.lastError ?? 'check the settings'}.` : 'Connect your mailbox first — enquiries are sent from your own email address and replies are read from it.'}
      <Link to="/freight/mailbox" className="font-medium underline">
        {a ? 'Fix it' : 'Connect mailbox'}
      </Link>
    </div>
  );
}

export function FreightListPage() {
  const { session, can } = useSession();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const status = params.get('status') ?? 'OPEN';
  useEffect(() => {
    const n = new URLSearchParams(params);
    if (debounced) n.set('search', debounced);
    else n.delete('search');
    setParams(n, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  const q = useQuery({
    queryKey: ['freight', 'list', status, debounced],
    queryFn: () => api.get<EnquiryRow[]>(`/freight/enquiries${qs({ status, search: debounced })}`),
    placeholderData: keepPreviousData,
    enabled: !!session?.activeCompany,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Freight quotations"
        subtitle="Ask shipping lines for rates by email, negotiate in the same thread and book the best offer."
        actions={
          <>
            <Link to="/freight/mailbox" className="text-[13px] text-brand-700 hover:underline">
              My mailbox
            </Link>
            {can('sales.freight', 'create') && (
              <Link to="/freight/new">
                <Button variant="primary" icon={<Plus className="size-3.5" />}>
                  New enquiry
                </Button>
              </Link>
            )}
          </>
        }
      />
      <MailboxBanner />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input className="field-input pl-7" placeholder="Number, port or cargo…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search enquiries" />
        </div>
        <div className="flex flex-wrap gap-1" role="tablist">
          {STATUSES.map((s) => (
            <button
              key={s || 'all'}
              role="tab"
              aria-selected={status === s}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set('status', s);
                setParams(n, { replace: true });
              }}
              className={`rounded px-2.5 py-1 text-[12.5px] ${status === s ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {s ? label(s) : 'All'}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <Card className="p-6 text-center text-[13px] text-slate-500">
            No enquiries here yet. {can('sales.freight', 'create') && <Link className="text-brand-700 underline" to="/freight/new">Create one</Link>} — or press "Get freight quotes" on a shipment lot.
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[12px] text-slate-500">
                <tr>
                  {['Enquiry', 'Date', 'Route', 'Containers', 'Ready', 'Replies', 'Status'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link to={`/freight/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.number}
                      </Link>
                      {r.unread > 0 && <span className="ml-2 rounded-full bg-brand-700 px-1.5 text-[11px] text-white">{r.unread} new</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(r.enquiryDate)}</td>
                    <td className="px-3 py-2">
                      {r.portOfLoading} → {r.portOfDischarge}
                    </td>
                    <td className="px-3 py-2">
                      {r.containerCount} × {r.containerType}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(r.readyDate)}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.replied}/{r.sent} replied · {r.quoted} quoted
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ENQUIRY_TONE[r.status]}>{label(r.status)}</Badge>
                      {r.awardedTo && <span className="ml-1.5 text-slate-600">{r.awardedTo}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}

interface Draft {
  enquiryDate: string;
  shipmentId?: string;
  proformaInvoiceId?: string;
  piNumber?: string | null;
  lotNo?: number;
  portOfLoading: string;
  portOfDischarge: string;
  containerType: string;
  containerCount: number;
  commodity?: string | null;
  grossWeightMt?: string | null;
  readyDate?: string | null;
  incoterm?: string | null;
  freeDaysWanted?: number | null;
  replyBy?: string | null;
  reminderHours: number;
  notes?: string | null;
}

/** New enquiry; from a shipment lot the route, containers and cargo are filled in. */
export function FreightNewPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const shipment = params.get('shipment') ?? '';
  const q = useQuery({ queryKey: ['freight', 'draft', shipment], queryFn: () => api.get<Draft>(`/freight/enquiries/draft${qs({ shipmentId: shipment })}`) });
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) setD(q.data);
  }, [q.data]);
  if (q.isLoading || !d) return q.error ? <div className="p-6"><ErrorBox error={q.error} /></div> : <Spinner />;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((o) => (o ? { ...o, [k]: v } : o));
  const fieldErr = (k: string) => (error && typeof error === 'object' && 'fields' in error ? (error as { fields: Record<string, string> }).fields[k] : undefined);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { piNumber: _p, lotNo: _l, ...body } = d;
      const e = await api.post<{ id: string }>('/freight/enquiries', {
        ...body,
        commodity: d.commodity || null,
        grossWeightMt: d.grossWeightMt || null,
        readyDate: d.readyDate || null,
        replyBy: d.replyBy || null,
        incoterm: d.incoterm || null,
        notes: d.notes || null,
      });
      nav(`/freight/${e.id}?send=1`);
    } catch (e) {
      setError(e);
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const text = (k: keyof Draft, lbl: string, extra: Record<string, unknown> = {}) => (
    <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
      {lbl}
      <input className="field-input" aria-invalid={!!fieldErr(k)} value={(d[k] as string | number | null | undefined) ?? ''} onChange={(e) => set(k, e.target.value as never)} {...extra} />
      {fieldErr(k) && <span className="text-[12px] font-normal text-red-600">{fieldErr(k)}</span>}
    </label>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="New freight enquiry" subtitle={d.shipmentId ? `For lot ${d.lotNo} of ${d.piNumber ?? 'the order'} — check the details, then choose whom to ask.` : 'Describe the shipment; next you choose the shipping lines to ask.'} />
      <MailboxBanner />
      <div className="p-3 sm:p-5">
        <Card className="grid max-w-3xl gap-3 p-4 sm:grid-cols-2">
          {text('portOfLoading', 'Port of loading', { placeholder: 'e.g. Mundra', 'data-autofocus': true })}
          {text('portOfDischarge', 'Port of discharge', { placeholder: 'e.g. Jebel Ali' })}
          {text('containerType', 'Container type', { placeholder: "e.g. 20' FCL" })}
          <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
            No. of containers
            <input className="field-input" type="number" min={1} value={d.containerCount} onChange={(e) => set('containerCount', Number(e.target.value))} />
          </label>
          {text('commodity', 'Commodity')}
          {text('grossWeightMt', 'Gross weight (MT)', { inputMode: 'decimal' })}
          {text('readyDate', 'Cargo ready date', { type: 'date' })}
          <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
            Free days wanted at destination
            <input className="field-input" type="number" min={0} value={d.freeDaysWanted ?? ''} onChange={(e) => set('freeDaysWanted', e.target.value === '' ? null : Number(e.target.value))} />
          </label>
          {text('replyBy', 'Ask for replies by', { type: 'date' })}
          <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
            Automatic reminder after
            <select className="field-input" value={d.reminderHours} onChange={(e) => set('reminderHours', Number(e.target.value))}>
              {[...new Set([0, 24, 48, 72, d.reminderHours])].sort((a, b) => a - b).map((h) => (
                <option key={h} value={h}>
                  {h ? `${h} hours without a reply` : 'No reminders'}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12.5px] font-medium text-slate-700 sm:col-span-2">
            Internal notes
            <textarea className="field-input" rows={2} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <ErrorBox error={error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="primary" loading={busy} onClick={save}>
              Save and choose contacts
            </Button>
            <Button onClick={() => nav(-1)}>Cancel</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
