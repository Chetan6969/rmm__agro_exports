import { formatDocNumber, validatePattern } from '@rmm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';

interface Series {
  docType: string;
  label: string;
  pattern: string;
  resetYearly: boolean;
  financialYear: string | null;
  nextSeq: number;
  nextNumber: string;
}

export function NumberingPage() {
  const { session, can } = useSession();
  const q = useQuery({ queryKey: ['numbering'], queryFn: () => api.get<Series[]>('/numbering'), enabled: !!session?.activeCompany });
  if (!session?.activeCompany) return <div className="p-6"><ErrorBox error={new Error('Select a company first (Alt+C).')} /></div>;
  if (q.isLoading) return <Spinner />;

  return (
    <div className="flex-1 overflow-y-auto">
      <PageHeader
        title="Document numbering"
        subtitle={`Number series of ${session.activeCompany.name}. Numbers are issued only when a document is saved, without gaps or duplicates.`}
      />
      <div className="space-y-3 p-5">
        {q.error && <ErrorBox error={q.error} />}
        <Card className="p-3 text-[12.5px] text-slate-600">
          Tokens: <code className="font-mono">{'{CO}'}</code> company code · <code className="font-mono">{'{FY}'}</code> 26-27 ·{' '}
          <code className="font-mono">{'{FYL}'}</code> 2026-27 · <code className="font-mono">{'{YYYY}'}</code> · <code className="font-mono">{'{MM}'}</code> ·{' '}
          <code className="font-mono">{'{SEQ:3}'}</code> running number padded to 3 digits. Moving from Excel? Set <b>Next no.</b> to continue your current series.
        </Card>
        <Card>
          <table className="w-full">
            <thead className="bg-slate-50 text-[11.5px] text-slate-500 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Document</th>
                <th className="px-3 py-2 text-left font-semibold">Pattern</th>
                <th className="px-3 py-2 text-center font-semibold">Restart each FY</th>
                <th className="px-3 py-2 text-right font-semibold">Next no.</th>
                <th className="px-3 py-2 text-left font-semibold">Next document number</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((s) => (
                <SeriesRow key={s.docType} s={s} code={session.activeCompany!.code} editable={can('admin.numbering', 'edit')} />
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function SeriesRow({ s, code, editable }: { s: Series; code: string; editable: boolean }) {
  const qc = useQueryClient();
  const [pattern, setPattern] = useState(s.pattern);
  const [reset, setReset] = useState(s.resetYearly);
  const [next, setNext] = useState(String(s.nextSeq));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPattern(s.pattern);
    setReset(s.resetYearly);
    setNext(String(s.nextSeq));
  }, [s]);

  const err = validatePattern(pattern);
  const seq = Number(next) || 1;
  const preview = err ? '—' : formatDocNumber(pattern, { companyCode: code, date: new Date(), seq });
  const dirty = pattern !== s.pattern || reset !== s.resetYearly || next !== String(s.nextSeq);

  const save = async () => {
    if (err || !dirty) return;
    setBusy(true);
    try {
      await api.put(`/numbering/${s.docType}`, { pattern, resetYearly: reset, ...(next !== String(s.nextSeq) ? { nextSeq: seq } : {}) });
      await qc.invalidateQueries({ queryKey: ['numbering'] });
      toast.success(`${s.label} numbering saved`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key === 's')) {
      e.preventDefault();
      save();
    }
  };

  return (
    <tr className="border-t border-slate-100" onKeyDown={onKey}>
      <td className="px-3 py-1.5 font-medium text-slate-800">
        {s.label} {s.financialYear && <Badge>FY {s.financialYear}</Badge>}
      </td>
      <td className="px-3 py-1.5">
        <input className="field-input font-mono" value={pattern} disabled={!editable} aria-invalid={!!err} onChange={(e) => setPattern(e.target.value)} aria-label={`${s.label} pattern`} />
        {err && <div className="text-[11.5px] text-red-600">{err}</div>}
      </td>
      <td className="px-3 py-1.5 text-center">
        <input type="checkbox" className="size-4 accent-brand-700" checked={reset} disabled={!editable} onChange={(e) => setReset(e.target.checked)} aria-label={`${s.label} restarts every financial year`} />
      </td>
      <td className="w-24 px-3 py-1.5">
        <input className="field-input text-right tabular-nums" inputMode="numeric" value={next} disabled={!editable} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} aria-label={`${s.label} next number`} />
      </td>
      <td className="px-3 py-1.5 font-mono text-[13px] text-brand-800">{preview}</td>
      <td className="px-3 py-1.5 text-right">
        {editable && (
          <Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty || !!err} loading={busy} onClick={save}>
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}
