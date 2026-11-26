import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, CalendarDays, Container, Mail, MapPin, Minus, Plus, Search, Ship } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { enterNavigation, focusSibling } from '../../components/EntityForm';
import { Chip, groupByOrder, OrderGroups } from '../../components/OrderGroups';
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
  const searchRef = useRef<HTMLInputElement>(null);
  const setStatus = (s: string) => {
    const n = new URLSearchParams(params);
    n.set('status', s);
    setParams(n, { replace: true });
  };
  useHotkeys(
    {
      '/': () => searchRef.current?.focus(),
      'alt+n': () => can('freight.quotations', 'create') && navigate('/freight/new'),
      'alt+m': () => navigate('/freight/mailbox'),
      ...Object.fromEntries(STATUSES.map((s, i) => [`alt+${i + 1}`, () => setStatus(s)])),
    },
    [params],
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
            {can('freight.quotations', 'create') && (
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
                if (e.key === 'Enter' && rows.length === 1) navigate(`/freight/${rows[0].id}`);
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
        <span className="ml-auto text-[12px] text-slate-400 max-md:hidden">/ search · Alt+N new · Alt+1–5 status</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <Card className="p-6 text-center text-[13px] text-slate-500">
            No enquiries here yet. {can('freight.quotations', 'create') && <Link className="text-brand-700 underline" to="/freight/new">Create one</Link>} — or press "Get freight quotes" on a shipment lot.
          </Card>
        ) : (
          <OrderGroups
            groups={groupByOrder(rows, (r) => ({ orderId: r.orderId, orderNumber: r.orderNumber, buyer: r.buyer, orderSource: r.orderSource }))}
            noOrderLabel="Enquiries not linked to an order"
            summary={(g) => {
              const unread = g.items.reduce((a, r) => a + r.unread, 0);
              const booked = g.items.filter((r) => r.status === 'AWARDED').length;
              return (
                <>
                  <Chip>{g.items.length} enquiry(ies)</Chip>
                  {booked > 0 && <Chip tone="green">{booked} booked</Chip>}
                  {unread > 0 && <Chip tone="amber">{unread} new reply(ies)</Chip>}
                </>
              );
            }}
          >
            {(g) => (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="text-left text-[12px] text-slate-500">
                    <tr>
                      {['Enquiry', 'Lot', 'Date', 'Route', 'Containers', 'Ready', 'Replies', 'Status'].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r) => (
                      <tr key={r.id} onClick={() => navigate(`/freight/${r.id}`)} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50">
                        <td className="px-3 py-2">
                          <Link to={`/freight/${r.id}`} className="font-medium text-brand-700 hover:underline">
                            {r.number}
                          </Link>
                          {r.unread > 0 && <span className="ml-2 rounded-full bg-brand-700 px-1.5 text-[11px] text-white">{r.unread} new</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{r.lotNo ? `Lot ${r.lotNo}` : '—'}</td>
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
              </div>
            )}
          </OrderGroups>
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
const PICKERS = {
  portOfLoading: { entity: 'ports', label: 'Port of loading', placeholder: 'Search ports… (F2 = list)' },
  portOfDischarge: { entity: 'ports', label: 'Port of discharge', placeholder: 'Search ports…' },
  containerType: { entity: 'containerTypes', label: 'Container type', placeholder: "e.g. 20' FCL" },
  commodity: { entity: 'products', label: 'Commodity', placeholder: 'Search products…' },
} as const;
type PickerKey = keyof typeof PICKERS;

const STEPS = ['Shipment details', 'Choose shipping lines', 'Compare & book'];

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-100 px-5 py-5 first:border-t-0 sm:px-6">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand-50 text-brand-700">{icon}</span>
        <div>
          <h2 className="text-[13.5px] font-semibold text-slate-800">{title}</h2>
          {hint && <p className="text-[12px] text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

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

  const field = (k: string, lbl: string, input: ReactNode, help?: string) => (
    <div className="grid content-start gap-1.5">
      <label htmlFor={`fq-${k}`} className="text-[12.5px] font-medium text-slate-700">
        {lbl}
      </label>
      {input}
      {fieldErr(k) ? <span className="text-[12px] text-red-600">{fieldErr(k)}</span> : help ? <span className="text-[11.5px] text-slate-400">{help}</span> : null}
    </div>
  );
  const text = (k: keyof Draft, lbl: string, extra: Record<string, unknown> = {}, help?: string) =>
    field(
      k,
      lbl,
      <input id={`fq-${k}`} data-nav="1" className="field-input" aria-invalid={!!fieldErr(k)} value={(d[k] as string | number | null | undefined) ?? ''} onChange={(e) => set(k, e.target.value as never)} {...extra} />,
      help,
    );
  const picker = (k: PickerKey) =>
    field(
      k,
      PICKERS[k].label,
      <RefSelect
        id={`fq-${k}`}
        entity={PICKERS[k].entity}
        value={ids[k] ?? null}
        label={(d[k] as string | null) || null}
        invalid={!!fieldErr(k)}
        placeholder={PICKERS[k].placeholder}
        allowCreate
        onChange={(id, name) => {
          setIds((o) => ({ ...o, [k]: id }));
          set(k, (name ?? '') as never);
        }}
        onCommit={next}
      />,
    );
  const count = Math.max(1, d.containerCount || 1);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6 sm:py-8">
        {/* heading */}
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-brand-700 text-white shadow-sm">
            <Ship className="size-5" />
          </div>
          <h1 className="text-[20px] font-semibold text-slate-900">New freight enquiry</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {d.shipmentId ? (
              <>
                For <b className="text-slate-700">lot {d.lotNo}</b> of <b className="text-slate-700">{d.piNumber ?? 'the order'}</b> — details are filled in from the order; check them and continue.
              </>
            ) : (
              'Describe the shipment once. Next you pick the shipping lines, and each one gets a personal mail from you.'
            )}
          </p>
        </div>

        {/* steps */}
        <ol className="mx-auto mb-5 flex max-w-xl items-center justify-center gap-2 text-[12px]" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2" aria-current={i === 0 ? 'step' : undefined}>
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${i === 0 ? 'bg-brand-700 text-white' : 'bg-slate-200 text-slate-500'}`}>{i + 1}</span>
              <span className={`whitespace-nowrap ${i === 0 ? 'font-medium text-slate-800' : 'text-slate-500'} max-sm:hidden`}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-300 sm:w-10" aria-hidden />}
            </li>
          ))}
        </ol>

        <div className="mb-4 overflow-hidden rounded-lg empty:hidden">
          <MailboxBanner />
        </div>

        <div ref={formRef} onKeyDown={enterNavigation} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <Section icon={<MapPin className="size-4" />} title="Route" hint="Where the cargo is loaded and where it goes">
            <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
              {picker('portOfLoading')}
              <ArrowRight className="mx-auto mt-8 size-4 text-slate-400 max-sm:hidden" aria-hidden />
              {picker('portOfDischarge')}
            </div>
          </Section>

          <Section icon={<Container className="size-4" />} title="Cargo" hint="What the shipping lines should quote for">
            <div className="grid gap-3 sm:grid-cols-2">
              {picker('containerType')}
              {field(
                'containerCount',
                'No. of containers',
                <div className="flex">
                  <button type="button" tabIndex={-1} aria-label="One container less" onClick={() => set('containerCount', Math.max(1, count - 1))} className="rounded-l border border-r-0 border-slate-300 bg-slate-50 px-3 text-slate-600 hover:bg-slate-100">
                    <Minus className="size-3.5" />
                  </button>
                  <input
                    id="fq-containerCount"
                    data-nav="1"
                    type="number"
                    min={1}
                    className="field-input rounded-none text-center tabular-nums"
                    value={d.containerCount}
                    onChange={(e) => set('containerCount', Number(e.target.value))}
                  />
                  <button type="button" tabIndex={-1} aria-label="One container more" onClick={() => set('containerCount', count + 1)} className="rounded-r border border-l-0 border-slate-300 bg-slate-50 px-3 text-slate-600 hover:bg-slate-100">
                    <Plus className="size-3.5" />
                  </button>
                </div>,
                '↑ ↓ change the number',
              )}
              {picker('commodity')}
              {text('grossWeightMt', 'Gross weight (MT)', { inputMode: 'decimal', placeholder: 'e.g. 1050' })}
            </div>
          </Section>

          <Section icon={<CalendarDays className="size-4" />} title="Dates & terms">
            <div className="grid gap-3 sm:grid-cols-3">
              {text('readyDate', 'Cargo ready', { type: 'date' })}
              {text('replyBy', 'Ask for replies by', { type: 'date' })}
              {text(
                'freeDaysWanted',
                'Free days at destination',
                {
                  type: 'number',
                  min: 0,
                  placeholder: 'e.g. 14',
                  value: d.freeDaysWanted ?? '',
                  onChange: (e: ChangeEvent<HTMLInputElement>) => set('freeDaysWanted', e.target.value === '' ? null : Number(e.target.value)),
                },
              )}
            </div>
          </Section>

          <Section icon={<BellRing className="size-4" />} title="Follow-up">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
              {field(
                'reminderHours',
                'Automatic reminder',
                <select id="fq-reminderHours" data-nav="1" className="field-input" value={d.reminderHours} onChange={(e) => set('reminderHours', Number(e.target.value))}>
                  {[...new Set([0, 24, 48, 72, d.reminderHours])]
                    .sort((a, b) => a - b)
                    .map((h) => (
                      <option key={h} value={h}>
                        {h ? `After ${h} hours without a reply` : 'No reminders'}
                      </option>
                    ))}
                </select>,
                'Sent only to lines that have not answered',
              )}
              {field('notes', 'Internal notes', <textarea id="fq-notes" data-nav="1" className="field-input resize-y" rows={2} placeholder="Only for your team — not sent in the mail" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />)}
            </div>
          </Section>

          {error ? (
            <div className="px-5 pb-4 sm:px-6">
              <ErrorBox error={error} />
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3.5 sm:px-6">
            <span className="text-[12px] text-slate-500 max-sm:hidden">Enter next field · F2 open list · Alt+N add new in a list</span>
            <div className="ml-auto flex gap-2">
              <Button onClick={() => nav('/freight')} shortcut="esc">
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s" data-nav-end icon={<ArrowRight className="size-3.5" />}>
                Save and choose shipping lines
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
