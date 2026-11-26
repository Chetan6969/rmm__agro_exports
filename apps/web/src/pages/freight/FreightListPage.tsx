import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Mail, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { enterNavigation, focusSibling } from '../../components/EntityForm';
import { RefSelect } from '../../components/RefSelect';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
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
  const navigate = useNavigate();
  const rows = q.data ?? [];
  const [sel, setSel] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => setSel(0), [status, debounced]);
  useEffect(() => {
    tableRef.current?.querySelector(`[data-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const setStatus = (s: string) => {
    const n = new URLSearchParams(params);
    n.set('status', s);
    setParams(n, { replace: true });
  };
  useHotkeys(
    {
      '/': () => searchRef.current?.focus(),
      arrowdown: () => setSel((i) => Math.min(i + 1, rows.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      enter: () => rows[sel] && navigate(`/freight/${rows[sel].id}`),
      'alt+n': () => can('sales.freight', 'create') && navigate('/freight/new'),
      'alt+m': () => navigate('/freight/mailbox'),
      ...Object.fromEntries(STATUSES.map((s, i) => [`alt+${i + 1}`, () => setStatus(s)])),
    },
    [rows, sel, params],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Freight quotations"
        subtitle="Ask shipping lines for rates by email, negotiate in the same thread and book the best offer."
        actions={
          <>
            <Button onClick={() => navigate('/freight/mailbox')} shortcut="alt+m">
              My mailbox
            </Button>
            {can('sales.freight', 'create') && (
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => navigate('/freight/new')} shortcut="alt+n">
                New enquiry
              </Button>
            )}
          </>
        }
      />
      <MailboxBanner />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="field-input pl-7"
            placeholder="Number, port or cargo…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // leave the box to move through the rows with the arrows
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
                if (e.key === 'Enter' && rows[0]) navigate(`/freight/${rows[0].id}`);
              }
            }}
            aria-label="Search enquiries"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="tablist">
          {STATUSES.map((s, i) => (
            <button
              key={s || 'all'}
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              title={`Alt+${i + 1}`}
              className={`rounded px-2.5 py-1 text-[12.5px] ${status === s ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {s ? label(s) : 'All'}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12px] text-slate-400 max-md:hidden">/ search · ↑ ↓ choose · Enter open · Alt+N new · Alt+1–5 status</span>
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
              <tbody ref={tableRef}>
                {q.data.map((r, i) => (
                  <tr
                    key={r.id}
                    data-row={i}
                    aria-selected={i === sel}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => navigate(`/freight/${r.id}`)}
                    className={`border-t border-slate-100 ${i === sel ? 'bg-brand-50 outline-2 -outline-offset-2 outline-brand-600/40' : 'hover:bg-slate-50'}`}
                  >
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

/** Fields picked from masters (the enquiry keeps the chosen name, so mails read naturally). */
const PICKERS: { key: 'portOfLoading' | 'portOfDischarge' | 'containerType' | 'commodity'; entity: string; label: string; placeholder: string }[] = [
  { key: 'portOfLoading', entity: 'ports', label: 'Port of loading', placeholder: 'Type to search ports… (F2 = list)' },
  { key: 'portOfDischarge', entity: 'ports', label: 'Port of discharge', placeholder: 'Type to search ports…' },
  { key: 'containerType', entity: 'containerTypes', label: 'Container type', placeholder: "e.g. 20' FCL" },
  { key: 'commodity', entity: 'products', label: 'Commodity', placeholder: 'Type to search products…' },
];

/** New enquiry; from a shipment lot the route, containers and cargo are filled in. Fully keyboard driven. */
export function FreightNewPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const shipment = params.get('shipment') ?? '';
  const q = useQuery({ queryKey: ['freight', 'draft', shipment], queryFn: () => api.get<Draft>(`/freight/enquiries/draft${qs({ shipmentId: shipment })}`) });
  const [d, setD] = useState<Draft | null>(null);
  const [ids, setIds] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.data) setD(q.data);
  }, [q.data]);
  // put the cursor in the first field once the form is there
  const ready = !!d;
  useEffect(() => {
    if (ready) setTimeout(() => formRef.current?.querySelector<HTMLElement>('[data-nav]')?.focus(), 0);
  }, [ready]);

  const save = async () => {
    if (!d || busy) return;
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
  useHotkeys({ 'mod+s, mod+enter': () => save(), esc: () => nav('/freight') }, [d, busy], { inInputs: true });

  if (q.isLoading || !d) return q.error ? <div className="p-6"><ErrorBox error={q.error} /></div> : <Spinner />;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((o) => (o ? { ...o, [k]: v } : o));
  const fieldErr = (k: string) => (error && typeof error === 'object' && 'fields' in error ? (error as { fields: Record<string, string> }).fields[k] : undefined);
  const next = () => {
    const root = formRef.current;
    const at = document.activeElement as HTMLElement | null;
    if (root && at) focusSibling(root, at, 1);
  };

  const field = (k: string, lbl: string, input: ReactNode) => (
    <div className="grid content-start gap-1">
      <label htmlFor={`fq-${k}`} className="text-[12.5px] font-medium text-slate-700">
        {lbl}
      </label>
      {input}
      {fieldErr(k) && <span className="text-[12px] text-red-600">{fieldErr(k)}</span>}
    </div>
  );
  const text = (k: keyof Draft, lbl: string, extra: Record<string, unknown> = {}) =>
    field(
      k,
      lbl,
      <input id={`fq-${k}`} data-nav="1" className="field-input" aria-invalid={!!fieldErr(k)} value={(d[k] as string | number | null | undefined) ?? ''} onChange={(e) => set(k, e.target.value as never)} {...extra} />,
    );
  const picker = (pk: (typeof PICKERS)[number]) =>
    field(
      pk.key,
      pk.label,
      <RefSelect
        id={`fq-${pk.key}`}
        entity={pk.entity}
        value={ids[pk.key] ?? null}
        label={(d[pk.key] as string | null) || null}
        invalid={!!fieldErr(pk.key)}
        placeholder={pk.placeholder}
        allowCreate
        onChange={(id, name) => {
          setIds((o) => ({ ...o, [pk.key]: id }));
          set(pk.key, (name ?? '') as never);
        }}
        onCommit={next}
      />,
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="New freight enquiry"
        subtitle={d.shipmentId ? `For lot ${d.lotNo} of ${d.piNumber ?? 'the order'} — check the details, then choose whom to ask.` : 'Describe the shipment; next you choose the shipping lines to ask.'}
      />
      <MailboxBanner />
      <div className="p-3 sm:p-5">
        <Card className="max-w-3xl p-4">
          <div ref={formRef} className="grid gap-3 sm:grid-cols-2" onKeyDown={enterNavigation}>
            {picker(PICKERS[0])}
            {picker(PICKERS[1])}
            {picker(PICKERS[2])}
            {text('containerCount', 'No. of containers', { type: 'number', min: 1, value: d.containerCount, onChange: (e: ChangeEvent<HTMLInputElement>) => set('containerCount', Number(e.target.value)) })}
            {picker(PICKERS[3])}
            {text('grossWeightMt', 'Gross weight (MT)', { inputMode: 'decimal' })}
            {text('readyDate', 'Cargo ready date', { type: 'date' })}
            {text('freeDaysWanted', 'Free days wanted at destination', {
              type: 'number',
              min: 0,
              value: d.freeDaysWanted ?? '',
              onChange: (e: ChangeEvent<HTMLInputElement>) => set('freeDaysWanted', e.target.value === '' ? null : Number(e.target.value)),
            })}
            {text('replyBy', 'Ask for replies by', { type: 'date' })}
            {field(
              'reminderHours',
              'Automatic reminder after',
              <select id="fq-reminderHours" data-nav="1" className="field-input" value={d.reminderHours} onChange={(e) => set('reminderHours', Number(e.target.value))}>
                {[...new Set([0, 24, 48, 72, d.reminderHours])]
                  .sort((a, b) => a - b)
                  .map((h) => (
                    <option key={h} value={h}>
                      {h ? `${h} hours without a reply` : 'No reminders'}
                    </option>
                  ))}
              </select>,
            )}
            <div className="sm:col-span-2">
              {field('notes', 'Internal notes', <textarea id="fq-notes" data-nav="1" className="field-input" rows={2} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />)}
            </div>
            <div className="sm:col-span-2">
              <ErrorBox error={error} />
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s" data-nav-end>
                Save and choose contacts
              </Button>
              <Button onClick={() => nav('/freight')} shortcut="esc">
                Cancel
              </Button>
              <span className="text-[12px] text-slate-500 max-sm:hidden">Enter = next field · F2 = open list · Alt+N in a list = add a new port / container / product</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
