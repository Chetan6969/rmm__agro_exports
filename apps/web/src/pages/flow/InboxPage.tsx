import { INTAKE_KINDS, intakeKind } from '@rmm/shared';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Inbox, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { useHotkeys } from '../../lib/hotkeys';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { useDebounced } from '../MasterListPage';

export interface InboxRow {
  id: string;
  fileName: string;
  fileKind: string;
  sourcePath: string | null;
  status: string;
  kind: string | null;
  kindConfidence: string | null;
  readMethod: string | null;
  ocrConfidence: number | null;
  pages: number | null;
  orderId: string | null;
  shipmentId: string | null;
  orderNumber: string | null;
  lotNo: number | null;
  result: string | null;
  error: string | null;
  createdAt: string;
}

const TABS = [
  { key: 'OPEN', label: 'To do' },
  { key: 'TO_REVIEW', label: 'To review' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'IGNORED', label: 'Ignored' },
  { key: 'FAILED', label: 'Could not read' },
  { key: '', label: 'All' },
];
export const STATUS_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = { QUEUED: 'slate', READING: 'blue', TO_REVIEW: 'amber', CONFIRMED: 'green', IGNORED: 'slate', FAILED: 'red' };
export const STATUS_LABEL: Record<string, string> = { QUEUED: 'Waiting', READING: 'Reading…', TO_REVIEW: 'To review', CONFIRMED: 'Confirmed', IGNORED: 'Ignored', FAILED: 'Could not read' };
const METHOD: Record<string, string> = { text: 'Text', ocr: 'OCR', mixed: 'Text + OCR', none: '—' };

/** Upload any number of files to the inbox; they are read on the server in the background. */
export async function uploadToInbox(list: FileList | File[]) {
  const fd = new FormData();
  for (const f of Array.from(list)) fd.append('file', f, f.name);
  const r = await api.post<{ id: string; fileName: string; duplicateOf: string | null; error?: string }[]>('/intake/upload', fd);
  const bad = r.filter((x) => x.error);
  const dup = r.filter((x) => x.duplicateOf);
  const ok = r.length - bad.length - dup.length;
  if (ok) toast.success(`${ok} document(s) added`, { description: 'They are being read now — scans take a few seconds a page.' });
  if (dup.length) toast.info(`${dup.length} already in the inbox`, { description: dup.map((d) => d.fileName).join(', ').slice(0, 200) });
  if (bad.length) toast.error(`${bad.length} file(s) not added`, { description: `${bad[0].fileName}: ${bad[0].error}` });
  return r;
}

export function InboxPage() {
  const { session, can } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'OPEN';
  const kind = params.get('kind') ?? '';
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const [sel, setSel] = useState(0);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const q = useQuery({
    queryKey: ['inbox', status, kind, debounced],
    queryFn: () => api.get<{ rows: InboxRow[]; total: number; counts: Record<string, number> }>(`/intake${qs({ status, kind, search: debounced })}`),
    placeholderData: keepPreviousData,
    enabled: !!session?.activeCompany,
    refetchInterval: (query) => (query.state.data?.rows.some((r) => r.status === 'QUEUED' || r.status === 'READING') ? 2500 : false),
  });
  const rows = q.data?.rows ?? [];
  const counts = q.data?.counts ?? {};
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
    setSel(0);
  };
  useEffect(() => set('search', debounced), [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (list: FileList | File[]) => {
    if (!list.length) return;
    setUploading(true);
    try {
      await uploadToInbox(list);
      qc.invalidateQueries({ queryKey: ['inbox'] });
    } catch (e) {
      showError(e);
    } finally {
      setUploading(false);
    }
  };

  useHotkeys(
    {
      '/': () => searchRef.current?.focus(),
      arrowdown: () => setSel((i) => Math.min(i + 1, rows.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      enter: () => rows[sel] && navigate(`/inbox/${rows[sel].id}`),
      'alt+u': () => fileRef.current?.click(),
      ...Object.fromEntries(TABS.map((t, i) => [`alt+${i + 1}`, () => set('status', t.key || 'ALL')])),
    },
    [rows, sel, params],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (can('sales.intake', 'create')) void upload(e.dataTransfer.files);
      }}
    >
      <PageHeader
        title="Document inbox"
        subtitle="Drop any document — buyer PO, contract, LC, booking, BL, shipping bill, certificates, test reports. It is read on this server (offline OCR for scans), recognised and matched; you check and confirm."
        actions={
          can('sales.intake', 'create') && (
            <Button variant="primary" icon={<FileUp className="size-3.5" />} loading={uploading} onClick={() => fileRef.current?.click()} shortcut="alt+u">
              Upload documents
            </Button>
          )
        }
      />
      <input ref={fileRef} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.xlsx,.xls,.docx,.doc,.txt" onChange={(e) => e.target.files && upload(e.target.files).finally(() => (e.target.value = ''))} />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-5">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            className="field-input pl-7"
            placeholder="File, PO, invoice, BL no.…  ( / )"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label="Search the inbox"
          />
        </div>
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t, i) => {
            const n = t.key === 'OPEN' ? (counts.QUEUED ?? 0) + (counts.READING ?? 0) + (counts.TO_REVIEW ?? 0) + (counts.FAILED ?? 0) : t.key ? (counts[t.key] ?? 0) : undefined;
            const active = status === t.key || (!t.key && status === 'ALL');
            return (
              <button key={t.label} role="tab" aria-selected={active} title={`Alt+${i + 1}`} onClick={() => set('status', t.key || 'ALL')} className={`rounded px-2.5 py-1 text-[12.5px] ${active ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {t.label}
                {n !== undefined && n > 0 && <span className={`ml-1 text-[11px] ${active ? 'text-white/80' : 'text-slate-400'}`}>{n}</span>}
              </button>
            );
          })}
        </div>
        <select className="field-input w-auto" value={kind} onChange={(e) => set('kind', e.target.value)} aria-label="Document type">
          <option value="">All document types</option>
          {INTAKE_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {drag && (
          <div className="mb-3 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-600 bg-brand-50 p-8 text-[14px] font-medium text-brand-800">
            <FileUp className="size-5" /> Drop the files to add them to the inbox
          </div>
        )}
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center text-[13px] text-slate-500">
            <Inbox className="size-8 text-slate-300" />
            Nothing here. Drag and drop documents onto this page, or press <b>Upload documents</b> (Alt+U).
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-slate-50 text-left text-[12px] text-slate-500">
                <tr>
                  {['Document', 'Recognised as', 'Read by', 'Belongs to', 'Status', 'Added'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    aria-selected={i === sel}
                    onClick={() => setSel(i)}
                    onDoubleClick={() => navigate(`/inbox/${r.id}`)}
                    ref={(el) => {
                      if (i === sel) el?.scrollIntoView({ block: 'nearest' });
                    }}
                    className={`border-t border-slate-100 ${i === sel ? 'bg-brand-50 outline-2 -outline-offset-2 outline-brand-600/40' : 'hover:bg-slate-50'}`}
                  >
                    <td className="max-w-[340px] px-3 py-2">
                      <Link to={`/inbox/${r.id}`} className="block truncate font-medium text-brand-700 hover:underline" title={r.sourcePath ?? r.fileName}>
                        {r.fileName}
                      </Link>
                      {r.sourcePath && <span className="block truncate text-[11.5px] text-slate-400">{r.sourcePath}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.kind ? intakeKind(r.kind).label : '—'}
                      {r.kindConfidence && r.status !== 'CONFIRMED' && <span className="ml-1 text-[11px] text-slate-400">{Math.round(Number(r.kindConfidence) * 100)}%</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.readMethod ? METHOD[r.readMethod] : '—'}
                      {r.ocrConfidence != null && <span className="ml-1 text-[11px] text-slate-400">{r.ocrConfidence}%</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {r.orderNumber ? (
                        <>
                          {r.orderNumber}
                          {r.lotNo != null && ` · lot ${r.lotNo}`}
                        </>
                      ) : (
                        <span className="text-slate-400">not matched</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
                      {r.error && <span className="block max-w-56 truncate text-[11.5px] text-red-600" title={r.error}>{r.error}</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{new Date(r.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <div className="mt-2 text-[12px] text-slate-400 max-md:hidden">/ search · ↑ ↓ choose · Enter open · Alt+U upload · Alt+1–6 tabs · drop files anywhere on the page</div>
      </div>
    </div>
  );
}
