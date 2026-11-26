import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, BellRing, MessageSquareReply, Paperclip, RefreshCw, Send, Trash2, Trophy, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { Badge, Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { showError } from '../../lib/notify';
import { useSession } from '../../lib/session';
import { enterNavigation } from '../../components/EntityForm';
import { TemplateEditor } from '../../components/TemplateEditor';
import { useHotkeys } from '../../lib/hotkeys';
import { MailboxBanner } from './FreightListPage';
import { ENQUIRY_TONE, fmtDate, fmtWhen, inr, label, THREAD_TONE, usd, type Contact, type Enquiry, type RankedRow, type Template, type ThreadDetail, type ThreadRow } from './types';

const useTemplates = () => useQuery({ queryKey: ['freight', 'templates'], queryFn: () => api.get<Template[]>('/freight/templates'), staleTime: 60_000 });
type Vars = Record<string, string | null>;

/** Real values for the boxes in the editor (for one contact or conversation of this enquiry). */
function useVars(enquiryId: string, who: { contactName?: string | null; carrier?: string | null; threadId?: string | null; targetRate?: string | null }) {
  const [vars, setVars] = useState<Vars | undefined>();
  const key = JSON.stringify(who);
  useEffect(() => {
    const h = setTimeout(() => {
      api
        .post<{ vars: Vars }>(`/freight/enquiries/${enquiryId}/preview`, { subject: '', body: '', ...who })
        .then((r) => setVars(r.vars))
        .catch(() => setVars(undefined));
    }, 250);
    return () => clearTimeout(h);
  }, [enquiryId, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return vars;
}

const pick = (all: Template[] | undefined, kind: string) => all?.find((t) => t.kind === kind && t.isDefault) ?? all?.find((t) => t.kind === kind);

export function FreightDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['freight', 'enquiry', id], queryFn: () => api.get<Enquiry>(`/freight/enquiries/${id}`), refetchInterval: 60_000 });
  const [sendOpen, setSendOpen] = useState(params.get('send') === '1');
  const [thread, setThread] = useState<string | null>(null);
  const [award, setAward] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Keyboard cursor in the best-value table (↑ ↓, Enter = open, Alt+B = book). */
  const [sel, setSel] = useState(0);
  const refresh = () => qc.invalidateQueries({ queryKey: ['freight'] });

  const data = q.data;
  const ranked = data?.comparison.rows ?? [];
  const isOpen = data?.status === 'OPEN';
  const canEdit = can('freight.quotations', 'edit');
  const notReplied = data?.threads.filter((t) => t.status === 'SENT').length ?? 0;
  useHotkeys(
    {
      arrowdown: () => setSel((i) => Math.min(i + 1, ranked.length - 1)),
      arrowup: () => setSel((i) => Math.max(i - 1, 0)),
      enter: () => ranked[sel] && setThread(ranked[sel].threadId),
      'alt+b': () => isOpen && canEdit && ranked[sel] && !ranked[sel].expired && setAward(ranked[sel].threadId),
      'alt+s': () => isOpen && can('freight.quotations', 'create') && setSendOpen(true),
      'alt+k': () => checkMail(),
      'alt+r': () => isOpen && canEdit && notReplied > 0 && remind(),
      del: () => can('freight.quotations', 'delete') && setDel(true),
      esc: () => nav('/freight'),
    },
    [ranked, sel, isOpen, notReplied, data],
  );

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <div className="p-6"><ErrorBox error={q.error} /></div>;
  const e = q.data;
  const open = e.status === 'OPEN';

  function checkMail() {
    act('sync', async () => {
      const r = await api.post<{ matched: number; quotes: number }>('/mail-account/sync');
      toast.success(r.matched ? `${r.matched} new reply(ies), ${r.quotes} quote(s) read` : 'No new replies yet');
    });
  }
  function remind() {
    act('remind', async () => {
      const r = await api.post<{ reminded: number }>(`/freight/enquiries/${id}/remind`);
      toast.success(`Reminder sent to ${r.reminded} contact(s)`);
    });
  }

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const setStatus = (status: string) =>
    act('status', async () => {
      const { threads: _t, comparison: _c, lot: _l, myMailbox: _m, id: _i, number: _n, awardedThreadId: _a, ...rest } = e;
      await api.put(`/freight/enquiries/${e.id}`, { ...rest, status });
      toast.success(`Enquiry ${label(status).toLowerCase()}`);
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {e.number} <Badge tone={ENQUIRY_TONE[e.status]}>{label(e.status)}</Badge>
          </span>
        }
        subtitle={`${e.portOfLoading} → ${e.portOfDischarge} · ${e.containerCount} × ${e.containerType}${e.commodity ? ` · ${e.commodity}` : ''}`}
        actions={
          <>
            <Button icon={<RefreshCw className="size-3.5" />} loading={busy === 'sync'} onClick={checkMail} shortcut="alt+k">
              Check mail
            </Button>
            {open && can('freight.quotations', 'create') && (
              <Button variant={e.threads.length ? 'secondary' : 'primary'} icon={<UserPlus className="size-3.5" />} onClick={() => setSendOpen(true)} shortcut="alt+s">
                {e.threads.length ? 'Ask more contacts' : 'Send rate request'}
              </Button>
            )}
            {open && canEdit && notReplied > 0 && (
              <Button icon={<BellRing className="size-3.5" />} loading={busy === 'remind'} onClick={remind} shortcut="alt+r">
                Remind {notReplied} pending
              </Button>
            )}
            {canEdit && (
              <select className="field-input w-auto" value="" onChange={(ev) => ev.target.value && setStatus(ev.target.value)} aria-label="Change status">
                <option value="">More…</option>
                {open ? (
                  <>
                    <option value="CLOSED">Close without booking</option>
                    <option value="CANCELLED">Cancel enquiry</option>
                  </>
                ) : (
                  <option value="OPEN">Re-open</option>
                )}
              </select>
            )}
            {can('freight.quotations', 'delete') && <Button variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setDel(true)} aria-label="Delete enquiry" />}
          </>
        }
      />
      <MailboxBanner />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3 sm:p-5">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-slate-600">
          <span>Date {fmtDate(e.enquiryDate)}</span>
          <span>Cargo ready {fmtDate(e.readyDate)}</span>
          <span>Replies by {fmtDate(e.replyBy)}</span>
          {e.freeDaysWanted != null && <span>{e.freeDaysWanted} free days wanted</span>}
          <span>{e.reminderHours ? `Auto reminder after ${e.reminderHours} h` : 'No auto reminders'}</span>
          {e.lot && (
            <Link to={`/shipments?pi=${e.lot.piNumber ?? ''}`} className="text-brand-700 hover:underline">
              Lot {e.lot.lotNo} · {e.lot.piNumber}
            </Link>
          )}
        </div>

        <Comparison e={e} canAward={open && canEdit} sel={sel} onSelect={setSel} onThread={setThread} onAward={setAward} />
        <div className="text-[12px] text-slate-400 max-md:hidden">
          ↑ ↓ choose an offer · Enter open the conversation · Alt+B book it · Alt+S send rate request · Alt+K check mail · Alt+R remind · Tab to the conversations · Esc back
        </div>

        <Card>
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <h2 className="text-[14px] font-semibold text-slate-800">Conversations ({e.threads.length})</h2>
            <span className="text-[12px] text-slate-500">Replies are read from {e.myMailbox ?? 'the sender’s mailbox'} automatically</span>
          </div>
          {!e.threads.length ? (
            <div className="p-4 text-[13px] text-slate-500">No mails sent yet. Press "Send rate request" to ask shipping lines for their rates.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {e.threads.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setThread(t.id)} className="grid w-full gap-1 px-3 py-2 text-left text-[13px] hover:bg-slate-50 sm:grid-cols-[1.2fr_1fr_1.2fr_auto] sm:items-center">
                    <span>
                      <span className="font-medium text-slate-800">{t.carrier}</span>
                      {t.unread > 0 && <span className="ml-2 rounded-full bg-brand-700 px-1.5 text-[11px] text-white">{t.unread} new</span>}
                      <span className="block text-[12px] text-slate-500">
                        {t.contactName ?? ''} {t.contactEmail}
                      </span>
                    </span>
                    <span className="text-[12px] text-slate-500">
                      {t.replies ? `Last reply ${fmtWhen(t.lastInboundAt)}` : `Sent ${fmtWhen(t.lastOutboundAt)}`}
                      {t.remindersSent > 0 && ` · ${t.remindersSent} reminder(s)`}
                    </span>
                    <span className="text-slate-700">{t.latestQuoteText ? `${t.latestQuoteText}${t.quoteRounds > 1 ? ` (round ${t.quoteRounds})` : ''}` : <span className="text-slate-400">No quote yet</span>}</span>
                    <Badge tone={THREAD_TONE[t.status]}>{label(t.status)}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {sendOpen && (
        <SendModal
          e={e}
          onClose={() => {
            setSendOpen(false);
            if (params.get('send')) setParams({}, { replace: true });
          }}
          onDone={refresh}
        />
      )}
      {thread && <ThreadModal id={thread} e={e} onClose={() => { setThread(null); refresh(); }} />}
      {award && <AwardModal e={e} threadId={award} onClose={() => setAward(null)} onDone={refresh} />}
      <ConfirmDialog
        open={del}
        title={`Delete enquiry ${e.number}?`}
        message="It moves to the recycle bin with its mails and quotes, and can be restored from there."
        confirmLabel="Delete"
        danger
        requireReason
        onClose={() => setDel(false)}
        onConfirm={async (reason) => {
          await api.del(`/freight/enquiries/${e.id}`, { reason });
          toast.success(`Enquiry ${e.number} moved to the recycle bin`);
          refresh();
          nav('/freight');
        }}
      />
    </div>
  );
}

/** Best value first: lowest total freight, then faster transit and more free days. */
function Comparison({ e, canAward, sel, onSelect, onThread, onAward }: { e: Enquiry; canAward: boolean; sel: number; onSelect: (i: number) => void; onThread: (id: string) => void; onAward: (id: string) => void }) {
  const rows = e.comparison.rows;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-slate-800">
          <Trophy className="size-4 text-amber-500" /> Best value comparison
        </h2>
        <span className="text-[12px] text-slate-500">
          Latest offer of each carrier for all {e.containerCount} containers · score: 70% cost, 15% transit, 15% free days{e.comparison.usdInr ? ` · $1 = ₹${e.comparison.usdInr}` : ''}
        </span>
      </div>
      {e.comparison.warnings.map((w) => (
        <div key={w} className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[12.5px] text-amber-800">
          {w}
        </div>
      ))}
      {!rows.length ? (
        <div className="p-4 text-[13px] text-slate-500">No quotes yet. Rates are read automatically from the replies as they arrive; you can also type one in from a conversation.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-[12px] text-slate-500">
              <tr>
                {['#', 'Carrier', 'Offer', 'Total (all containers)', 'Transit', 'Free days', 'Valid till', 'Score', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <RankRow key={r.id} r={r} e={e} best={r.rank === 1 && !r.expired} selected={i === sel} onSelect={() => onSelect(i)} canAward={canAward} onThread={onThread} onAward={onAward} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RankRow({
  r,
  e,
  best,
  selected,
  onSelect,
  canAward,
  onThread,
  onAward,
}: {
  r: RankedRow;
  e: Enquiry;
  best: boolean;
  selected: boolean;
  onSelect: () => void;
  canAward: boolean;
  onThread: (id: string) => void;
  onAward: (id: string) => void;
}) {
  const awarded = e.awardedThreadId === r.threadId;
  return (
    <tr
      aria-selected={selected}
      onClick={onSelect}
      ref={(el) => {
        if (selected) el?.scrollIntoView({ block: 'nearest' });
      }}
      className={`border-t border-slate-100 align-top ${best ? 'bg-brand-50/60' : ''} ${selected ? 'outline-2 -outline-offset-2 outline-brand-600/50' : ''} ${r.expired ? 'text-slate-400' : ''}`}
    >
      <td className="px-3 py-2 font-semibold">{r.rank}</td>
      <td className="px-3 py-2">
        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onThread(r.threadId)}>
          {r.carrier}
        </button>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {awarded && <Badge tone="green">Booked</Badge>}
          {r.reasons.map((x) => (
            <Badge key={x} tone={r.expired ? 'red' : 'green'}>
              {x}
            </Badge>
          ))}
          {r.auto && <Badge tone="amber">Read from mail — check</Badge>}
        </div>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {r.currency} {Number(r.amount).toLocaleString('en-US')}
        {r.perContainer ? ' / cntr' : ' lump sum'}
        {r.surcharges && Number(r.surcharges) ? <div className="text-[12px] text-slate-500">+ {r.surcharges} surcharges</div> : null}
        {r.revision > 1 && <div className="text-[12px] text-slate-500">round {r.revision}</div>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="font-semibold">{usd(r.totalUsd)}</div>
        <div className="text-[12px] text-slate-500">
          {inr(r.totalInr)} · {usd(r.perContainerUsd)}/cntr
        </div>
        {r.saveVsNext ? <div className="text-[12px] text-brand-700">saves {usd(r.saveVsNext)} vs next</div> : null}
        {r.negotiatedUsd ? <div className="text-[12px] text-brand-700">negotiated −{usd(r.negotiatedUsd)}</div> : null}
      </td>
      <td className="px-3 py-2">{r.transitDays != null ? `${r.transitDays} d` : '—'}</td>
      <td className="px-3 py-2">{r.freeDays ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.validUntil)}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-16 rounded bg-slate-200">
            <div className={`h-1.5 rounded ${best ? 'bg-brand-600' : 'bg-slate-400'}`} style={{ width: `${r.score}%` }} />
          </div>
          {r.score}
        </div>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <Button variant="ghost" icon={<MessageSquareReply className="size-3.5" />} onClick={() => onThread(r.threadId)}>
          Negotiate
        </Button>
        {canAward && !r.expired && (
          <Button variant={best ? 'primary' : 'secondary'} icon={<Award className="size-3.5" />} onClick={() => onAward(r.threadId)}>
            Book
          </Button>
        )}
      </td>
    </tr>
  );
}

function SendModal({ e, onClose, onDone }: { e: Enquiry; onClose: () => void; onDone: () => void }) {
  const contacts = useQuery({ queryKey: ['freight', 'contacts', e.id], queryFn: () => api.get<Contact[]>(`/freight/enquiries/${e.id}/contacts`) });
  const templates = useTemplates();
  const requests = templates.data?.filter((t) => t.kind === 'Rate request') ?? [];
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<{ email: string; name: string; carrier: string }[]>([]);
  const [tplId, setTplId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (contacts.data) setChosen(new Set(contacts.data.filter((c) => c.suggested && !c.alreadySent).map((c) => c.id)));
  }, [contacts.data]);
  useEffect(() => {
    const t = requests.find((x) => x.id === tplId) ?? pick(templates.data, 'Rate request');
    if (t && !tplId) {
      setTplId(t.id);
      setSubject(t.subject);
      setBody(t.body);
    }
  }, [templates.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = contacts.data?.find((c) => chosen.has(c.id)) ?? null;
  const vars = useVars(e.id, { contactName: first?.name ?? extra[0]?.name ?? null, carrier: first?.carrier ?? extra[0]?.carrier ?? null });

  const count = chosen.size + extra.filter((x) => x.email && x.carrier).length;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const recipients = [...[...chosen].map((contactId) => ({ contactId })), ...extra.filter((x) => x.email && x.carrier).map((x) => ({ email: x.email, name: x.name || null, carrier: x.carrier }))];
      const r = await api.post<{ sent: { email: string }[]; failed: { email: string; error: string; hint?: string }[] }>(`/freight/enquiries/${e.id}/send`, { recipients, subject, body });
      if (r.sent.length) toast.success(`Rate request sent to ${r.sent.length} contact(s)`, { description: 'Replies will appear here automatically.' });
      if (r.failed.length) {
        toast.error(`${r.failed.length} mail(s) not sent`, { description: `${r.failed[0].email}: ${r.failed[0].error}${r.failed[0].hint ? ` — ${r.failed[0].hint}` : ''}` });
      } else onClose();
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  useHotkeys({ 'mod+enter, mod+s': () => count > 0 && !busy && send() }, [count, busy, subject, body, chosen, extra], { inModal: true, inInputs: true });

  return (
    <Modal
      open
      title="Send rate request"
      width="max-w-5xl"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-[12px] text-slate-400 max-md:hidden">Tab / Shift+Tab move · Space ticks a contact · / in the message inserts a value</span>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant="primary" icon={<Send className="size-3.5" />} loading={busy} disabled={!count} onClick={send} shortcut="mod+enter">
            Send to {count} contact(s)
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          <div className="text-[12.5px] font-medium text-slate-700">Contacts (suggested ones for this route are ticked)</div>
          {contacts.isLoading ? (
            <Spinner />
          ) : !contacts.data?.length ? (
            <div className="rounded border border-slate-200 p-3 text-[12.5px] text-slate-500">
              No freight contacts saved yet. Add them in <Link className="text-brand-700 underline" to="/m/freightContacts">Masters → Freight contacts</Link>, or type an address below.
            </div>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-auto rounded border border-slate-200">
              {contacts.data.map((c) => (
                <li key={c.id}>
                  <label className={`flex items-start gap-2 px-2.5 py-1.5 text-[13px] ${c.alreadySent ? 'text-slate-400' : ''}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={c.alreadySent}
                      checked={chosen.has(c.id)}
                      onChange={(ev) =>
                        setChosen((s) => {
                          const n = new Set(s);
                          if (ev.target.checked) n.add(c.id);
                          else n.delete(c.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{c.carrier}</span> · {c.name}
                      <span className="block truncate text-[12px] text-slate-500">
                        {c.email} · {c.alreadySent ? 'already asked' : c.reason}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {extra.map((x, i) => (
            <div key={i} className="grid grid-cols-3 gap-1.5">
              {(['carrier', 'name', 'email'] as const).map((k) => (
                <input
                  key={k}
                  className="field-input"
                  placeholder={k === 'carrier' ? 'Shipping line' : k === 'name' ? 'Contact name' : 'Email'}
                  value={x[k]}
                  onChange={(ev) => setExtra((xs) => xs.map((y, j) => (j === i ? { ...y, [k]: ev.target.value } : y)))}
                />
              ))}
            </div>
          ))}
          <button type="button" className="text-[12.5px] text-brand-700 hover:underline" onClick={() => setExtra((xs) => [...xs, { email: '', name: '', carrier: '' }])}>
            + Add someone not in the contact list
          </button>
        </div>
        <div className="space-y-2">
          <label className="grid gap-1 text-[12.5px] font-medium text-slate-700">
            Template
            <select
              className="field-input"
              value={tplId}
              onChange={(ev) => {
                const t = requests.find((x) => x.id === ev.target.value);
                setTplId(ev.target.value);
                if (t) {
                  setSubject(t.subject);
                  setBody(t.body);
                }
              }}
            >
              {requests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <TemplateEditor value={subject} onChange={setSubject} vars={vars} ariaLabel="Subject" />
          <TemplateEditor value={body} onChange={setBody} vars={vars} multiline rows={11} ariaLabel="Message" />
          <div className="text-[12px] text-slate-500">
            Boxes are filled for each contact{first ? ` (showing ${first.name}, ${first.carrier})` : ''}, so everyone gets a personal mail. Press <kbd className="kbd">/</kbd> to insert a value, Backspace twice to remove one. Company templates: Masters → Email templates.
          </div>
          <ErrorBox error={error} />
        </div>
      </div>
    </Modal>
  );
}

function ThreadModal({ id, e, onClose }: { id: string; e: Enquiry; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['freight', 'thread', id], queryFn: () => api.get<ThreadDetail>(`/freight/threads/${id}`) });
  const templates = useTemplates();
  const [mode, setMode] = useState<'Counter offer' | 'Reply' | 'Reminder'>('Counter offer');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const vars = useVars(e.id, { threadId: id, targetRate: mode === 'Counter offer' ? target || null : null });
  const t = q.data;
  const open = e.status === 'OPEN';

  // the counter offer aims at the best rival's per-container rate
  const rival = useMemo(() => e.comparison.rows.find((r) => r.threadId !== id && !r.expired), [e, id]);
  useEffect(() => {
    if (mode === 'Reply') setBody('Dear {{contact_name}},\n\n\n\nBest regards,\n{{sender_name}}\n{{company}}');
    else setBody(pick(templates.data, mode)?.body ?? '');
    if (mode === 'Counter offer' && rival && !target) setTarget(`USD ${Math.round(rival.perContainerUsd)}`);
  }, [mode, templates.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useHotkeys(
    {
      'mod+enter': () => open && !!t && !busy && body.trim().length >= 2 && send(),
      'alt+1': () => setMode('Counter offer'),
      'alt+2': () => setMode('Reply'),
      'alt+3': () => setMode('Reminder'),
      'alt+q': () => open && setQuoteOpen(true),
    },
    [t, busy, body, target, mode, open],
    { inModal: true, inInputs: true, enabled: !quoteOpen },
  );

  if (!t) return <Modal open title="Conversation" onClose={onClose}>{q.error ? <ErrorBox error={q.error} /> : <Spinner />}</Modal>;
  const latest = t.quotes[t.quotes.length - 1] ?? null;

  async function send() {
    if (!t) return;
    setBusy(true);
    try {
      await api.post(`/freight/threads/${id}/reply`, { body, subject: null, targetRate: mode === 'Counter offer' ? target || null : null });
      toast.success(`Mail sent to ${t.contactEmail}`);
      qc.invalidateQueries({ queryKey: ['freight'] });
      setMode('Counter offer');
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`${t.carrier} — ${t.contactName ?? t.contactEmail}`} width="max-w-5xl" onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          {t.messages.map((m) => (
            <div key={m.id} className={`rounded border p-2.5 text-[13px] ${m.direction === 'in' ? 'border-sky-200 bg-sky-50/50' : 'ml-6 border-slate-200 bg-white'}`}>
              <div className="mb-1 flex flex-wrap justify-between gap-2 text-[11.5px] text-slate-500">
                <span>{m.direction === 'in' ? `From ${m.fromAddress}` : `You → ${m.toAddress}`}</span>
                <span>{fmtWhen(m.sentAt)}</span>
              </div>
              <div className="font-medium text-slate-800">{m.subject}</div>
              <MessageBody text={m.bodyText} />
              {m.attachments?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {m.attachments.map((a) =>
                    a.fileId ? (
                      <a key={a.fileId} href={`/api/files/${a.fileId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand-700 hover:underline">
                        <Paperclip className="size-3" /> {a.name}
                      </a>
                    ) : (
                      <span key={a.name} className="text-[12px] text-slate-400">
                        <Paperclip className="inline size-3" /> {a.name} (too large, open it in your mailbox)
                      </span>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {open && (
            <div className="space-y-2 rounded border border-slate-200 p-2.5">
              <div className="flex flex-wrap items-center gap-1">
                {(['Counter offer', 'Reply', 'Reminder'] as const).map((k, i) => (
                  <button key={k} type="button" title={`Alt+${i + 1}`} onClick={() => setMode(k)} className={`rounded px-2.5 py-1 text-[12.5px] ${mode === k ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {k} <span className={`text-[10.5px] ${mode === k ? 'text-white/70' : 'text-slate-400'}`}>Alt+{i + 1}</span>
                  </button>
                ))}
              </div>
              {mode === 'Counter offer' && (
                <label className="grid gap-1 text-[12.5px] text-slate-600">
                  Our target rate per container {rival && <span className="text-[12px] text-slate-500">(best other offer: {rival.carrier}, {usd(rival.perContainerUsd)}/cntr)</span>}
                  <input className="field-input" value={target} onChange={(ev) => setTarget(ev.target.value)} placeholder="e.g. USD 900" />
                </label>
              )}
              <TemplateEditor value={body} onChange={setBody} vars={vars} multiline rows={8} ariaLabel="Message" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-slate-500">Sent in the same mail thread. Press / to insert a value (their last rate, our target…).</span>
                <Button variant="primary" icon={<Send className="size-3.5" />} loading={busy} disabled={body.trim().length < 2} onClick={send} shortcut="mod+enter">
                  Send
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold text-slate-800">Quotes ({t.quotes.length})</h3>
            {open && (
              <Button onClick={() => setQuoteOpen(true)} shortcut="alt+q">
                {latest ? 'Correct / add round' : 'Add quote'}
              </Button>
            )}
          </div>
          {!t.quotes.length && <div className="text-[12.5px] text-slate-500">No quote yet. One is read automatically from each reply that mentions a rate.</div>}
          {[...t.quotes].reverse().map((qt) => (
            <div key={qt.id} className="rounded border border-slate-200 p-2 text-[12.5px]">
              <div className="flex justify-between">
                <span className="font-medium">
                  Round {qt.revision}: {qt.currency} {Number(qt.amount).toLocaleString('en-US')}
                  {qt.perContainer ? ' / cntr' : ' lump sum'}
                </span>
                {qt.auto ? <Badge tone="amber">From mail</Badge> : <Badge>Confirmed</Badge>}
              </div>
              <div className="text-slate-600">
                {qt.transitDays != null ? `${qt.transitDays} d transit · ` : ''}
                {qt.freeDays != null ? `${qt.freeDays} free days · ` : ''}
                valid {fmtDate(qt.validUntil)}
              </div>
              {qt.evidence?.length ? <div className="mt-1 text-[11.5px] text-slate-500 italic">“{qt.evidence.join(' / ')}”</div> : null}
              {qt.notes && <div className="text-[11.5px] text-slate-500">{qt.notes}</div>}
            </div>
          ))}
        </div>
      </div>
      {quoteOpen && <QuoteModal threadId={id} latest={latest} onClose={() => setQuoteOpen(false)} onDone={() => qc.invalidateQueries({ queryKey: ['freight'] })} />}
    </Modal>
  );
}

/** Shows the new text of a reply; the quoted history folds away. */
function MessageBody({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const cut = text.search(/^\s*(>|on .{3,120} wrote:|-{2,}\s*original message)/im);
  const shown = full || cut < 0 ? text : text.slice(0, cut).trimEnd();
  return (
    <>
      <pre className="mt-1 font-sans text-[13px] whitespace-pre-wrap text-slate-700">{shown}</pre>
      {cut >= 0 && (
        <button type="button" className="text-[12px] text-slate-500 hover:underline" onClick={() => setFull((f) => !f)}>
          {full ? 'Hide earlier mail' : 'Show earlier mail'}
        </button>
      )}
    </>
  );
}

function QuoteModal({ threadId, latest, onClose, onDone }: { threadId: string; latest: ThreadDetail['quotes'][number] | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    currency: latest?.currency ?? 'USD',
    amount: latest ? String(Number(latest.amount)) : '',
    perContainer: latest?.perContainer ?? true,
    surcharges: latest?.surcharges ? String(Number(latest.surcharges)) : '',
    freeDays: latest?.freeDays ?? '',
    transitDays: latest?.transitDays ?? '',
    validUntil: latest?.validUntil ?? '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const num = (v: string | number) => (v === '' ? null : Number(v));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/freight/threads/${threadId}/quotes`, { ...f, surcharges: f.surcharges || null, freeDays: num(f.freeDays), transitDays: num(f.transitDays), validUntil: f.validUntil || null, notes: f.notes || null });
      toast.success('Quote saved');
      onDone();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  useHotkeys({ 'mod+enter, mod+s': () => !busy && save() }, [f, busy], { inModal: true, inInputs: true });
  const inp = (k: keyof typeof f, lbl: string, props: Record<string, unknown> = {}) => (
    <label className="grid gap-1 text-[12.5px] text-slate-700">
      {lbl}
      <input data-nav="1" className="field-input" value={f[k] as string} onChange={(e) => setF((o) => ({ ...o, [k]: e.target.value }))} {...props} />
    </label>
  );
  return (
    <Modal
      open
      title={latest ? 'Correct the quote / record a new round' : 'Record quote'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} shortcut="mod+s" data-nav-end>
            Save quote
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5" onKeyDown={enterNavigation}>
        {inp('currency', 'Currency', { maxLength: 3, 'data-autofocus': true })}
        {inp('amount', 'Amount', { inputMode: 'decimal' })}
        <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-slate-700">
          <input type="checkbox" data-nav="1" checked={f.perContainer} onChange={(e) => setF((o) => ({ ...o, perContainer: e.target.checked }))} /> Rate is per container (Space to untick for one lump sum)
        </label>
        {inp('surcharges', 'Surcharges per container', { inputMode: 'decimal' })}
        {inp('transitDays', 'Transit days', { inputMode: 'numeric' })}
        {inp('freeDays', 'Free days', { inputMode: 'numeric' })}
        {inp('validUntil', 'Valid until', { type: 'date' })}
        <div className="col-span-2">{inp('notes', 'Notes')}</div>
        <div className="col-span-2">
          <ErrorBox error={error} />
        </div>
      </div>
    </Modal>
  );
}

function AwardModal({ e, threadId, onClose, onDone }: { e: Enquiry; threadId: string; onClose: () => void; onDone: () => void }) {
  const { can } = useSession();
  const t = e.threads.find((x) => x.id === threadId) as ThreadRow;
  const row = e.comparison.rows.find((r) => r.threadId === threadId);
  const others = e.threads.filter((x) => x.id !== threadId && x.lastInboundAt).length;
  const [opts, setOpts] = useState({ notifyWinner: true, notifyOthers: true, applyToShipment: !!e.lot && can('sales.shipments', 'edit') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ mailed: string[]; failed: { email: string; error: string }[]; charge: { label: string } | null }>(`/freight/enquiries/${e.id}/award`, { threadId, ...opts });
      toast.success(`Booked with ${t.carrier}`, { description: [r.mailed.length ? `${r.mailed.length} mail(s) sent` : '', r.charge ? 'Freight added to the lot charges' : ''].filter(Boolean).join(' · ') || undefined });
      if (r.failed.length) toast.error(`${r.failed.length} mail(s) could not be sent`, { description: `${r.failed[0].email}: ${r.failed[0].error}` });
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  useHotkeys({ 'mod+enter': () => !busy && save() }, [opts, busy], { inModal: true, inInputs: true });
  const box = (k: keyof typeof opts, text: string, disabled = false) => (
    <label className={`flex items-start gap-2 text-[13px] ${disabled ? 'text-slate-400' : 'text-slate-700'}`}>
      <input type="checkbox" className="mt-0.5" disabled={disabled} checked={opts[k]} onChange={(ev) => setOpts((o) => ({ ...o, [k]: ev.target.checked }))} />
      {text}
    </label>
  );
  return (
    <Modal
      open
      title={`Book with ${t.carrier}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} shortcut="esc">
            Cancel
          </Button>
          <Button variant="primary" icon={<Award className="size-3.5" />} loading={busy} onClick={save} shortcut="mod+enter" data-autofocus>
            Confirm booking
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        {row && (
          <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-[13px]">
            {row.currency} {Number(row.amount).toLocaleString('en-US')}
            {row.perContainer ? ' per container' : ' lump sum'} · total {usd(row.totalUsd)} ({inr(row.totalInr)}) · rank {row.rank} of {e.comparison.rows.length}
            {row.auto && <div className="mt-1 text-[12px] text-amber-700">This rate was read from their mail automatically — open the conversation to check it first.</div>}
          </div>
        )}
        {box('notifyWinner', `Send ${t.carrier} the booking confirmation mail`)}
        {box('notifyOthers', `Send a polite regret to the ${others} other carrier(s) who replied`, !others)}
        {box('applyToShipment', e.lot ? `Put this freight (in ₹) on lot ${e.lot.lotNo} of ${e.lot.piNumber} as the ocean freight charge` : 'Not linked to a shipment lot', !e.lot || !can('sales.shipments', 'edit'))}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
