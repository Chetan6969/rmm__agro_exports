import {
  add,
  childDocs,
  computeTotals,
  CONTAINER_FIELDS,
  DOCS,
  formatAmount,
  getDoc,
  isDecimal,
  isPositive,
  lineAmount,
  mul,
  round,
  statusLabel,
  type DocDef,
  type EntityDef,
  type LiveRatesResponse,
} from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, FileText, History, Package, Pencil, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { EntityForm, type Values } from '../components/EntityForm';
import { ConfirmDialog, Modal } from '../components/Modal';
import { Badge, Button, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useHotkeys } from '../lib/hotkeys';
import { showError } from '../lib/notify';
import { useSession } from '../lib/session';
import { STATUS_TONE } from './DocumentListPage';

type Labels = Record<string, string | null | undefined>;
interface Line extends Values {
  _key: string;
  _labels: Labels;
}
interface Term {
  _key: string;
  tcTemplateId: string | null;
  content: string;
}
interface Container extends Values {
  _key: string;
}
interface Child {
  doc: keyof typeof DOCS;
  rows: { id: string; documentNumber: string; documentDate: string; status: string; totalQuantityMt: string }[];
  usedMt: string;
  remainingMt: string;
}
type Loaded = Values & { id?: string; version?: number; lines: Values[]; terms: Values[]; containers: Values[]; children?: Child[]; updatedAt?: string; amountInWords?: string };

let seq = 0;
const key = () => `k${++seq}`;
const asEntity = (k: string, fields: DocDef['header']) => ({ key: k, fields }) as unknown as EntityDef;
const labelsOf = (fields: DocDef['header'], src: Values): Labels => Object.fromEntries(fields.filter((f) => f.type === 'ref' || f.type === 'doc').map((f) => [f.name, (src[`${f.name}Label`] as string) ?? null]));

/** Splits a T&C template body into one term per line, dropping leading numbering. */
const splitTerms = (body: string) =>
  body
    .split(/\r?\n/)
    .map((x) => x.replace(/^\s*(\d+|[a-z])[.)]\s+/i, '').trim())
    .filter(Boolean);

export function DocumentFormPage() {
  const { doc = '', id = 'new' } = useParams();
  const [params] = useSearchParams();
  const def = getDoc(doc);
  if (!def) return <div className="p-6"><ErrorBox error={new Error(`Unknown document type: ${doc}`)} /></div>;
  const from = params.get('from') ?? '';
  return <DocumentForm key={`${def.key}-${id}-${from}`} def={def} id={id} from={from} />;
}

function DocumentForm({ def, id, from }: { def: DocDef; id: string; from: string }) {
  const isNew = id === 'new';
  const { can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);

  const [header, setHeader] = useState<Values>({});
  const [labels, setLabels] = useState<Labels>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null; line: Line } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rateNote, setRateNote] = useState<string | null>(null);

  const source = useQuery({
    queryKey: ['documents', def.key, 'one', id, from],
    queryFn: () => api.get<Loaded>(isNew ? `/documents/${def.key}/draft${from ? `?from=${from}` : ''}` : `/documents/${def.key}/${id}`),
    refetchOnWindowFocus: false,
  });
  const record = source.data;

  useEffect(() => {
    if (loaded || !record) return;
    const h: Values = {};
    for (const f of def.header) h[f.name] = record[f.name] ?? (f.type === 'boolean' ? false : null);
    setHeader(h);
    setLabels(labelsOf(def.header, record));
    setLines(record.lines.map((l) => ({ ...l, _key: key(), _labels: labelsOf(def.lines, l) })));
    setTerms(record.terms.map((t) => ({ _key: key(), tcTemplateId: (t.tcTemplateId as string) ?? null, content: String(t.content) })));
    setContainers(record.containers.map((c) => ({ ...c, _key: key() })));
    setLoaded(true);
    setTimeout(() => root.current?.querySelector<HTMLElement>('[data-nav]')?.focus(), 0);
  }, [record, loaded, def]);

  const readOnly = isNew ? !can(def.module, 'create') : !can(def.module, 'edit');
  const back = () => navigate(`/d/${def.key}`);
  const touch = () => setDirty(true);

  // ---------------------------------------------------------------- auto-fill from masters
  const liveRates = useQuery({ queryKey: ['exchange-rates'], queryFn: () => api.get<LiveRatesResponse>('/exchange-rates'), staleTime: 60_000, enabled: can('master.currencies', 'view') });

  const setField = (name: string, value: unknown, label?: string | null) => {
    setHeader((s) => ({ ...s, [name]: value }));
    if (label !== undefined) setLabels((s) => ({ ...s, [name]: label }));
  };

  const applyCurrency = async (currencyId: string | null, code: string | null) => {
    setRateNote(null);
    if (!currencyId) return;
    if (code === 'INR') {
      setField('exchangeRate', '1');
      return;
    }
    const live = liveRates.data?.rates.find((r) => r.code === code);
    if (live) {
      setField('exchangeRate', round(live.rateToInr, 4));
      setRateNote(`Live rate ${live.rateToInr} (${live.source}, ${live.rateDate}). Change it if your bank rate differs.`);
      return;
    }
    try {
      const cur = await api.get<Values>(`/masters/currencies/${currencyId}`);
      if (cur.exchangeRate) {
        setField('exchangeRate', String(cur.exchangeRate));
        setRateNote('No live rate for this currency: using the default rate from the currency master.');
      }
    } catch (e) {
      showError(e);
    }
  };

  const applyPaymentTerm = async (termId: string | null) => {
    if (!termId) return;
    try {
      const t = await api.get<Values>(`/masters/paymentTerms/${termId}`);
      setField('paymentTerms', (t.printText as string) || (t.name as string));
    } catch (e) {
      showError(e);
    }
  };

  /** Buyer defaults fill only the fields that are still empty. */
  const applyBuyer = async (buyerId: string | null) => {
    if (!buyerId) return;
    try {
      const c = await api.get<Values>(`/masters/customers/${buyerId}`);
      const fill: [string, string, string | null][] = [
        ['currencyId', 'defaultCurrencyId', null],
        ['paymentTermId', 'paymentTermId', null],
        ['portOfDischargeId', 'defaultPortId', null],
        ['destinationCountryId', 'countryId', null],
      ];
      const h = header;
      for (const [field, from] of fill) {
        if (!def.header.some((f) => f.name === field) || h[field] || !c[from]) continue;
        setField(field, c[from], (c[`${from}Label`] as string) ?? null);
        if (field === 'currencyId') await applyCurrency(c[from] as string, (c[`${from}Label`] as string) ?? null);
        if (field === 'paymentTermId' && !h.paymentTerms) await applyPaymentTerm(c[from] as string);
      }
      if (c.incoterm && ['FOB', 'CFR', 'CIF'].includes(c.incoterm as string) && h.incoterm === 'FOB') setField('incoterm', c.incoterm);
    } catch (e) {
      showError(e);
    }
  };

  const onHeaderChange = (name: string, v: unknown, l?: string | null) => {
    setField(name, v, l);
    setErrors((s) => {
      if (!s[name]) return s;
      const n = { ...s };
      delete n[name];
      return n;
    });
    touch();
    if (name === 'buyerId') void applyBuyer(v as string | null);
    if (name === 'currencyId') void applyCurrency(v as string | null, l ?? null);
    if (name === 'paymentTermId') void applyPaymentTerm(v as string | null);
    if (isNew && def.parent && name === def.parent.field && v) {
      // generate against the chosen parent: reload the draft with its remaining quantities
      navigate(`/d/${def.key}/new?from=${v}`, { replace: true });
    }
  };

  // ---------------------------------------------------------------- totals (same code as the server)
  const totals = useMemo(() => {
    try {
      const ok = lines.every((l) => isDecimal(String(l.quantityMt ?? '0')) && (l.ratePerMt == null || l.ratePerMt === '' || isDecimal(String(l.ratePerMt))));
      return ok ? computeTotals(def, header, lines) : null;
    } catch {
      return null;
    }
  }, [def, header, lines]);

  // ---------------------------------------------------------------- save
  const payload = () => {
    const body: Values = {};
    for (const f of def.header) body[f.name] = header[f.name];
    body.lines = lines.map((l) => {
      const x: Values = { sourceLineId: l.sourceLineId ?? null };
      for (const f of def.lines) x[f.name] = l[f.name];
      return x;
    });
    body.terms = terms.filter((t) => t.content.trim()).map((t) => ({ tcTemplateId: t.tcTemplateId, content: t.content }));
    body.containers = containers.map((c) => Object.fromEntries(CONTAINER_FIELDS.map((f) => [f.name, c[f.name]])));
    if (!isNew) body.version = record!.version;
    return body;
  };

  const save = async () => {
    if (readOnly || saving) return;
    setSaving(true);
    setErrors({});
    setLineErrors({});
    setFormError(null);
    try {
      const saved = isNew ? await api.post<Loaded>(`/documents/${def.key}`, payload()) : await api.put<Loaded>(`/documents/${def.key}/${id}`, payload());
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['lookup', 'document'] });
      toast.success(`${def.label} ${saved.documentNumber} saved`);
      setDirty(false);
      if (isNew) navigate(`/d/${def.key}/${saved.id}`, { replace: true });
      else {
        setLoaded(false);
        await source.refetch();
      }
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        const h: Record<string, string> = {};
        const le: Record<number, string> = {};
        for (const [k, msg] of Object.entries(e.fields)) {
          const m = /^lines\.(\d+)\./.exec(k);
          if (m) le[Number(m[1])] = msg;
          else h[k.replace(/^header\./, '')] = msg;
        }
        setErrors(h);
        setLineErrors(le);
        const first = Object.keys(h)[0];
        if (first) document.getElementById(`f-${first}`)?.focus();
      }
      setFormError(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (reason: string) => {
    await api.del(`/documents/${def.key}/${id}`, { reason });
    qc.invalidateQueries({ queryKey: ['documents'] });
    toast.success(`${def.label} ${record?.documentNumber} deleted`);
    back();
  };

  const openPdf = (kind: 'pdf' | 'packing-list.pdf') => {
    if (dirty) return showError(new Error('Save your changes first, then print.'));
    window.open(`/api/documents/${def.key}/${id}/${kind}`, '_blank', 'noopener');
  };

  useHotkeys(
    {
      'mod+s, mod+enter': () => save(),
      'alt+a': () => !readOnly && setEditing({ index: null, line: blankLine(def) }),
      'mod+p': () => !isNew && can(def.module, 'print') && openPdf('pdf'),
      esc: () => (editing ? setEditing(null) : dirty ? setConfirmLeave(true) : back()),
    },
    [header, lines, terms, containers, dirty, saving, record, editing],
    { inInputs: true },
  );

  if (source.isLoading) return <Spinner />;
  if (source.error) {
    return (
      <div className="space-y-3 p-6">
        <ErrorBox error={source.error} />
        <Button onClick={back}>Back to {def.plural.toLowerCase()}</Button>
      </div>
    );
  }

  const currency = labels.currencyId ?? '';
  const title = isNew ? `New ${def.label.toLowerCase()}` : `${def.label} ${record?.documentNumber ?? ''}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={root} data-form-root>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button type="button" tabIndex={-1} onClick={back} className="rounded p-0.5 text-slate-400 hover:bg-slate-100" aria-label="Back">
              <ArrowLeft className="size-4" />
            </button>
            {title}
            {!isNew && <Badge tone={STATUS_TONE[String(header.status)] ?? 'slate'}>{statusLabel(String(header.status ?? ''))}</Badge>}
            {readOnly && <Badge>Read only</Badge>}
          </span>
        }
        subtitle={def.plural}
        actions={
          <>
            {!isNew && can('admin.audit', 'view') && (
              <Link to={`/admin/audit?entity=${def.key}&recordId=${id}`} className="inline-flex items-center gap-1 px-2 text-[12.5px] text-slate-500 hover:text-slate-800">
                <History className="size-3.5" /> History
              </Link>
            )}
            {!isNew && can(def.module, 'print') && (
              <>
                <Button icon={<Printer className="size-3.5" />} onClick={() => openPdf('pdf')} shortcut="mod+p">
                  Print PDF
                </Button>
                {def.containers && (
                  <Button icon={<Package className="size-3.5" />} onClick={() => openPdf('packing-list.pdf')}>
                    Packing list
                  </Button>
                )}
              </>
            )}
            {!isNew && can(def.module, 'delete') && (
              <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            {!readOnly && (
              <Button variant="primary" data-nav-end icon={<Save className="size-3.5" />} loading={saving} onClick={save} shortcut="mod+s">
                Save
              </Button>
            )}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        <div className="mx-auto max-w-6xl space-y-4">
          {formError != null && <ErrorBox error={formError} />}
          {!isNew && record?.children && <ChildrenPanel def={def} id={id} items={record.children} canCreate={(m) => can(m, 'create')} dirty={dirty} />}
          <EntityForm def={asEntity(def.key, def.header)} values={header} labels={labels} errors={errors} readOnly={readOnly} onChange={onHeaderChange} />
          {rateNote && <div className="-mt-2 text-[12px] text-slate-500">{rateNote}</div>}

          <Section
            title={`Products (${lines.length})`}
            action={
              !readOnly && (
                <Button icon={<Plus className="size-3.5" />} onClick={() => setEditing({ index: null, line: blankLine(def) })} shortcut="alt+a">
                  Add line
                </Button>
              )
            }
          >
            <LinesTable
              def={def}
              lines={lines}
              currency={currency}
              errors={lineErrors}
              readOnly={readOnly}
              onEdit={(i) => setEditing({ index: i, line: { ...lines[i], _labels: { ...lines[i]._labels } } })}
              onRemove={(i) => {
                setLines((s) => s.filter((_, j) => j !== i));
                touch();
              }}
              onMove={(i, d) => {
                setLines((s) => {
                  const n = [...s];
                  const j = i + d;
                  if (j < 0 || j >= n.length) return s;
                  [n[i], n[j]] = [n[j], n[i]];
                  return n;
                });
                touch();
              }}
            />
            {errors.lines && <div className="mt-1 text-[12px] text-red-600">{errors.lines}</div>}
          </Section>

          {def.containers && (
            <Section title={`Containers (${containers.length}) · for the packing list`}>
              <ContainersEditor rows={containers} readOnly={readOnly} totalNetMt={totals?.totalQuantityMt} update={(fn) => (setContainers(fn), touch())} />
            </Section>
          )}

          <Section title={`Terms & conditions (${terms.length})`}>
            <TermsEditor def={def} terms={terms} readOnly={readOnly} update={(fn) => (setTerms(fn), touch())} />
          </Section>

          <TotalsPanel def={def} totals={totals} currency={currency} words={!dirty ? record?.amountInWords : null} />

          <div className="flex flex-wrap items-center justify-between gap-2 pb-6 text-[12px] text-slate-500">
            <span className="max-sm:hidden">Enter = next field · Alt+A = add line · Ctrl+S = save · Ctrl+P = print</span>
            {record?.updatedAt && <span>Last changed {new Date(record.updatedAt).toLocaleString()} · v{record.version}</span>}
          </div>
        </div>
      </div>

      {editing && (
        <LineEditor
          def={def}
          initial={editing.line}
          isNew={editing.index === null}
          onClose={() => setEditing(null)}
          onSave={(line, again) => {
            setLines((s) => (editing.index === null ? [...s, line] : s.map((x, i) => (i === editing.index ? line : x))));
            touch();
            if (again) setEditing({ index: null, line: blankLine(def) });
            else setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmLeave}
        title="Discard changes?"
        message="You have unsaved changes on this document."
        confirmLabel="Discard"
        danger
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => back()}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${def.label.toLowerCase()} ${record?.documentNumber ?? ''}?`}
        message="It disappears from lists and reports; the audit log keeps who deleted it and why. To keep it on record, set the status to Cancelled instead."
        confirmLabel="Delete"
        danger
        requireReason
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </div>
  );
}

function blankLine(def: DocDef): Line {
  const l: Line = { _key: key(), _labels: {}, sourceLineId: null };
  for (const f of def.lines) l[f.name] = f.default ?? (f.type === 'boolean' ? false : null);
  return l;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <h2 className="text-[12px] font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- lines
function LinesTable({
  def,
  lines,
  currency,
  errors,
  readOnly,
  onEdit,
  onRemove,
  onMove,
}: {
  def: DocDef;
  lines: Line[];
  currency: string;
  errors: Record<number, string>;
  readOnly: boolean;
  onEdit: (i: number) => void;
  onRemove: (i: number) => void;
  onMove: (i: number, d: 1 | -1) => void;
}) {
  if (!lines.length) return <div className="py-6 text-center text-[13px] text-slate-500">No products yet. Press Alt+A or “Add line”.</div>;
  const showRate = def.lines.some((f) => f.name === 'ratePerMt');
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[11.5px] text-slate-500 uppercase">
            <th className="w-8 py-1.5 pr-2">#</th>
            <th className="py-1.5 pr-2">Product</th>
            <th className="py-1.5 pr-2">Packing</th>
            <th className="py-1.5 pr-2 text-right">Bags</th>
            <th className="py-1.5 pr-2 text-right">Net (MT)</th>
            {showRate && <th className="py-1.5 pr-2 text-right">Rate {currency}</th>}
            {showRate && <th className="py-1.5 pr-2 text-right">Amount</th>}
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l._key} className={`border-b border-slate-100 align-top ${errors[i] ? 'bg-red-50' : ''}`} onDoubleClick={() => !readOnly && onEdit(i)}>
              <td className="py-1.5 pr-2 text-slate-400 tabular-nums">{i + 1}</td>
              <td className="py-1.5 pr-2">
                <div className="font-medium text-slate-900">{l._labels.productId ?? '—'}</div>
                {Boolean(l.packingText || l.hsCode) && <div className="text-[12px] whitespace-pre-line text-slate-500">{[l.packingText, l.hsCode ? `HS ${l.hsCode}` : ''].filter(Boolean).join(' · ')}</div>}
                {errors[i] && <div className="text-[12px] text-red-600">{errors[i]}</div>}
              </td>
              <td className="py-1.5 pr-2 text-slate-600">{l._labels.packingTypeId ?? ''}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{String(l.noOfBags ?? 0)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{safe(() => formatAmount(String(l.quantityMt ?? 0), 3))}</td>
              {showRate && <td className="py-1.5 pr-2 text-right tabular-nums">{safe(() => formatAmount(String(l.ratePerMt ?? 0)))}</td>}
              {showRate && <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{safe(() => formatAmount(lineAmount(l)))}</td>}
              <td className="py-1 text-right whitespace-nowrap">
                {!readOnly && (
                  <>
                    <IconBtn label="Move up" onClick={() => onMove(i, -1)} icon={<ArrowUp className="size-3.5" />} />
                    <IconBtn label="Move down" onClick={() => onMove(i, 1)} icon={<ArrowDown className="size-3.5" />} />
                    <IconBtn label="Edit line" onClick={() => onEdit(i)} icon={<Pencil className="size-3.5" />} />
                    <IconBtn label="Remove line" onClick={() => onRemove(i)} icon={<Trash2 className="size-3.5" />} danger />
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const safe = (fn: () => string) => {
  try {
    return fn();
  } catch {
    return '—';
  }
};

function IconBtn({ label, icon, onClick, danger }: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`rounded p-1 text-slate-400 hover:bg-slate-100 ${danger ? 'hover:text-red-600' : 'hover:text-slate-700'}`}>
      {icon}
    </button>
  );
}

/** Add / edit one product line; product and packing masters fill HS code, packing text, bags and gross weight. */
function LineEditor({ def, initial, isNew, onClose, onSave }: { def: DocDef; initial: Line; isNew: boolean; onClose: () => void; onSave: (l: Line, again: boolean) => void }) {
  const [line, setLine] = useState<Line>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [packing, setPacking] = useState<Values | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (typeof initial.packingTypeId === 'string') api.get<Values>(`/masters/packingTypes/${initial.packingTypeId}`).then(setPacking, () => setPacking(null));
  }, [initial.packingTypeId]);

  const set = (name: string, v: unknown, l?: string | null) =>
    setLine((s) => ({ ...s, [name]: v, _labels: l !== undefined ? { ...s._labels, [name]: l } : s._labels }));

  const onChange = async (name: string, v: unknown, l?: string | null) => {
    set(name, v, l);
    setErrors((s) => ({ ...s, [name]: '' }));
    try {
      if (name === 'productId' && v) {
        const p = await api.get<Values>(`/masters/products/${v}`);
        setLine((s) => ({ ...s, hsCode: s.hsCode || p.hsnCode || null, cropYear: s.cropYear || p.cropYear || null, brokenPct: s.brokenPct ?? p.brokenPct ?? null }));
      }
      if (name === 'packingTypeId' && v) {
        const p = await api.get<Values>(`/masters/packingTypes/${v}`);
        setPacking(p);
        setLine((s) => ({ ...s, packingText: s.packingText || (p.description as string) || (p.name as string) }));
      }
    } catch (e) {
      showError(e);
    }
  };

  /** Bags = net weight ÷ bag net weight; gross = net + bags × empty-bag weight. */
  const calcBags = () => {
    const net = String(packing?.netWeightKg ?? '');
    const qty = String(line.quantityMt ?? '');
    if (!isPositive(net) || !isDecimal(qty) || !isPositive(qty)) {
      setNote('Choose a packing with a net weight and enter the net weight (MT) first.');
      return;
    }
    const bags = Math.round((Number(qty) * 1000) / Number(net));
    const tareMt = mul(mul(String(bags), String(packing?.tareWeightKg ?? '0'), 6), '0.001', 3);
    setLine((s) => ({ ...s, noOfBags: bags, grossWtMt: add([qty, tareMt], 3) }));
    setNote(`${bags} bags of ${net} kg; gross adds ${packing?.tareWeightKg ?? 0} kg per empty bag.`);
  };

  const submit = (again: boolean) => {
    const e: Record<string, string> = {};
    for (const f of def.lines) {
      const v = line[f.name];
      if (f.required && (v === null || v === undefined || v === '')) e[f.name] = `${f.label} is required`;
      if ((f.type === 'decimal' || f.type === 'integer') && v !== null && v !== undefined && v !== '' && !isDecimal(String(v))) e[f.name] = `${f.label}: must be a number`;
    }
    if (!e.quantityMt && !isPositive(String(line.quantityMt ?? '0'))) e.quantityMt = 'Must be above 0';
    setErrors(e);
    if (Object.keys(e).length) {
      document.getElementById(`f-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    onSave(line, again);
  };

  return (
    <Modal
      open
      title={isNew ? 'Add product line' : 'Edit product line'}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <span className="mr-auto text-[12px] tabular-nums text-slate-500">Amount {safe(() => formatAmount(lineAmount(line)))}</span>
          <Button onClick={onClose}>Cancel</Button>
          {isNew && <Button onClick={() => submit(true)}>Save & add another</Button>}
          <Button variant="primary" onClick={() => submit(false)} data-nav-end>
            {isNew ? 'Add' : 'Update'}
          </Button>
        </>
      }
    >
      <div data-form-root className="max-h-[60vh] overflow-y-auto pr-1">
        <EntityForm def={asEntity(`${def.key}.line`, def.lines)} values={line} labels={line._labels} errors={errors} onChange={(n, v, l) => void onChange(n, v, l)} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={calcBags} title="From the packing master: bags and gross weight for this net weight">
            Calculate bags & gross weight
          </Button>
          {note && <span className="text-[12px] text-slate-500">{note}</span>}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- terms
function TermsEditor({ def, terms, readOnly, update }: { def: DocDef; terms: Term[]; readOnly: boolean; update: (fn: (t: Term[]) => Term[]) => void }) {
  const templates = useQuery({
    queryKey: ['masters', 'tcTemplates', 'for', def.tcDocType],
    queryFn: () => api.get<{ rows: Values[] }>('/masters/tcTemplates?pageSize=500&status=active'),
    enabled: !readOnly,
  });
  const usable = (templates.data?.rows ?? []).filter((t) => t.docType === def.tcDocType || t.docType === 'General');
  const edit = (i: number, content: string) => update((ts) => ts.map((t, j) => (j === i ? { ...t, content } : t)));
  const move = (i: number, d: number) =>
    update((ts) => {
      const j = i + d;
      if (j < 0 || j >= ts.length) return ts;
      const n = [...ts];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <div className="space-y-2">
      {!terms.length && <div className="text-[13px] text-slate-500">No terms. Add them from a T&C template or type your own.</div>}
      {terms.map((t, i) => (
        <div key={t._key} className="flex items-start gap-2">
          <span className="w-5 pt-1.5 text-right text-[12px] text-slate-400 tabular-nums">{i + 1}.</span>
          <textarea className="field-input min-h-[34px] flex-1 resize-y" rows={1} value={t.content} disabled={readOnly} onChange={(e) => edit(i, e.target.value)} aria-label={`Term ${i + 1}`} />
          {!readOnly && (
            <span className="flex shrink-0">
              <IconBtn label="Move up" onClick={() => move(i, -1)} icon={<ArrowUp className="size-3.5" />} />
              <IconBtn label="Move down" onClick={() => move(i, 1)} icon={<ArrowDown className="size-3.5" />} />
              <IconBtn label="Remove term" onClick={() => update((ts) => ts.filter((_, j) => j !== i))} icon={<Trash2 className="size-3.5" />} danger />
            </span>
          )}
        </div>
      ))}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button icon={<Plus className="size-3.5" />} onClick={() => update((ts) => [...ts, { _key: key(), tcTemplateId: null, content: '' }])}>
            Add term
          </Button>
          <select
            className="field-input w-auto"
            value=""
            onChange={(e) => {
              const tpl = usable.find((x) => x.id === e.target.value);
              if (tpl) update((ts) => [...ts, ...splitTerms(String(tpl.body)).map((content) => ({ _key: key(), tcTemplateId: tpl.id as string, content }))]);
            }}
            aria-label="Add terms from a template"
          >
            <option value="">{usable.length ? 'Add from T&C template…' : `No T&C templates for ${def.tcDocType} (Masters → T&C templates)`}</option>
            {usable.map((t) => (
              <option key={t.id as string} value={t.id as string}>
                {String(t.name)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- containers
function ContainersEditor({ rows, readOnly, totalNetMt, update }: { rows: Container[]; readOnly: boolean; totalNetMt?: string; update: (fn: (r: Container[]) => Container[]) => void }) {
  const set = (i: number, name: string, v: string) => update((rs) => rs.map((r, j) => (j === i ? { ...r, [name]: v } : r)));
  const sum = (name: string, scale: number) => safe(() => add(rows.map((r) => (isDecimal(String(r[name] ?? '')) ? String(r[name]) : '0')), scale));
  const netKg = sum('netWeightKg', 3);
  const mismatch = totalNetMt && rows.length && netKg !== '—' && round(mul(totalNetMt, '1000', 3), 3) !== netKg;
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-slate-500 uppercase">
                {CONTAINER_FIELDS.map((f) => (
                  <th key={f.name} className="py-1 pr-2 font-medium">
                    {f.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._key}>
                  {CONTAINER_FIELDS.map((f) => (
                    <td key={f.name} className="py-0.5 pr-2">
                      {f.type === 'select' ? (
                        <select className="field-input" disabled={readOnly} value={String(r[f.name] ?? f.default ?? '')} onChange={(e) => set(i, f.name, e.target.value)} aria-label={f.label}>
                          {f.options!.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={`field-input ${f.upper ? 'uppercase' : ''} ${f.type !== 'text' ? 'text-right tabular-nums' : ''}`}
                          disabled={readOnly}
                          inputMode={f.type === 'text' ? undefined : 'decimal'}
                          value={String(r[f.name] ?? '')}
                          onChange={(e) => set(i, f.name, f.upper ? e.target.value.toUpperCase() : e.target.value)}
                          aria-label={f.label}
                        />
                      )}
                    </td>
                  ))}
                  <td>{!readOnly && <IconBtn label="Remove container" onClick={() => update((rs) => rs.filter((_, j) => j !== i))} icon={<Trash2 className="size-3.5" />} danger />}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-[12.5px] font-medium text-slate-700">
                <td colSpan={3} className="pt-1">
                  Total
                </td>
                <td className="pt-1 pr-2 text-right tabular-nums">{sum('totalBags', 0)}</td>
                <td className="pt-1 pr-2 text-right tabular-nums">{netKg}</td>
                <td className="pt-1 pr-2 text-right tabular-nums">{sum('grossWeightKg', 3)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {mismatch && <div className="text-[12px] text-amber-700">Container net weight ({netKg} kg) differs from the invoice net weight ({round(mul(totalNetMt!, '1000', 3), 3)} kg).</div>}
      {!readOnly && (
        <Button icon={<Plus className="size-3.5" />} onClick={() => update((rs) => [...rs, { _key: key(), containerSize: '20FT' }])}>
          Add container
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- totals & linked documents
function TotalsPanel({ def, totals, currency, words }: { def: DocDef; totals: Record<string, string> | null; currency: string; words?: string | null }) {
  const main = def.key === 'proformaInvoices' ? 'grandTotal' : def.key === 'commercialInvoices' ? 'invoiceTotal' : 'goodsAmount';
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-xs">
      {!totals ? (
        <div className="text-[13px] text-amber-700">Totals appear once every line has a valid net weight and rate.</div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3 lg:grid-cols-5">
          {def.totals.map((t) => (
            <div key={t.name} className={t.name === main ? 'font-semibold text-slate-900' : 'text-slate-600'}>
              <dt className="text-[11.5px] text-slate-500">{t.label}</dt>
              <dd className="tabular-nums">
                {formatAmount(totals[t.name] ?? '0', t.scale)}
                {t.scale === 2 && currency ? ` ${currency}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {def.key === 'commercialInvoices' && <p className="mt-2 text-[11.5px] text-slate-400">FOB charges always count; ocean freight counts for CFR and CIF; insurance only for CIF.</p>}
      {words && <p className="mt-2 text-[12.5px] text-slate-600">In words: {words}</p>}
    </section>
  );
}

function ChildrenPanel({ def, id, items, canCreate, dirty }: { def: DocDef; id: string; items: Child[]; canCreate: (module: string) => boolean; dirty: boolean }) {
  const navigate = useNavigate();
  return (
    <>
      {items.map((c) => {
        const child = DOCS[c.doc];
        const left = isPositive(c.remainingMt);
        return (
          <section key={c.doc} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-sky-200 bg-sky-50/60 px-4 py-2.5 text-[13px]">
            <FileText className="size-4 text-sky-700" />
            <span>
              {child.plural}: <b>{c.usedMt} MT</b> used, <b className={left ? 'text-amber-700' : ''}>{c.remainingMt} MT</b> left
            </span>
            <span className="flex flex-wrap gap-1.5">
              {c.rows.map((r) => (
                <Link key={r.id} to={`/d/${child.key}/${r.id}`} className="rounded border border-sky-200 bg-white px-1.5 py-0.5 font-mono text-[12px] text-sky-800 hover:bg-sky-100">
                  {r.documentNumber}
                  {r.status === 'CANCELLED' ? ' (cancelled)' : ''}
                </Link>
              ))}
            </span>
            {canCreate(child.module) && childDocs(def.key).some((x) => x.key === child.key) && (
              <Button
                className="ml-auto"
                variant="primary"
                icon={<Plus className="size-3.5" />}
                disabled={!left || dirty}
                title={dirty ? 'Save your changes first' : left ? `Create a ${child.label.toLowerCase()} for the remaining quantity` : 'Nothing left'}
                onClick={() => navigate(`/d/${child.key}/new?from=${id}`)}
              >
                Create {child.label.toLowerCase()}
              </Button>
            )}
          </section>
        );
      })}
    </>
  );
}
