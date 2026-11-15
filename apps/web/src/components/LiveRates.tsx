import type { LiveRate, LiveRatesResponse } from '@rmm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { showError } from '../lib/notify';
import type { Column } from './DataGrid';
import { Badge, Button, ErrorBox } from './ui';

/** Base currency of every rate (rates are rupees per one unit of the currency). */
export const BASE_CURRENCY = 'INR';

const SOURCE_INFO: Record<LiveRate['source'], { label: string; title: string }> = {
  ECB: {
    label: 'ECB',
    title: 'European Central Bank daily reference rate (published around 16:00 CET on working days)',
  },
  'ECB+fawazahmed0': {
    label: 'ECB × market',
    title: 'The ECB does not publish this currency: ECB rupees per US dollar ÷ open market rate per US dollar (keeps USD pegs such as AED and SAR exact)',
  },
  fawazahmed0: {
    label: 'Market',
    title: 'Open market data (fawazahmed0 exchange-api); used because the ECB could not be reached',
  },
};

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(iso: string, now: number) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  if (seconds > -45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

const formatDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** Whole days between a rate's business date and today (in India). */
function daysOld(ymd: string, now: number) {
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  return Math.round((Date.parse(today) - Date.parse(ymd)) / 86_400_000);
}

/** Re-renders every `ms` so "x minutes ago" labels stay true while the page is open. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useLiveRates(enabled: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['exchange-rates'],
    queryFn: () => api.get<LiveRatesResponse>('/exchange-rates'),
    enabled,
    // The server decides when the providers are due again; polling only picks that up.
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const refresh = useMutation({
    mutationFn: () => api.post<LiveRatesResponse>('/exchange-rates/refresh'),
    onSuccess: (data) => qc.setQueryData(['exchange-rates'], data),
    onError: showError,
  });
  const byCode = useMemo(() => new Map((query.data?.rates ?? []).map((r) => [r.code, r])), [query.data]);
  return { query, refresh, byCode };
}

type Row = Record<string, unknown>;

/** Extra Currencies-grid columns: live rate, difference from the saved default, source and age. */
export function liveRateColumns(byCode: Map<string, LiveRate>, now: number, loading: boolean): Column<Row>[] {
  const rateOf = (r: Row) => byCode.get(String(r.code));
  const isBase = (r: Row) => r.code === BASE_CURRENCY;
  const pending = () => <span className="text-slate-400">{loading ? '…' : '—'}</span>;
  return [
    {
      key: '_liveRate',
      label: 'Live rate (₹)',
      align: 'right',
      className: 'font-mono text-[12.5px] font-medium text-slate-900',
      render: (r) => (isBase(r) ? '1 (base)' : rateOf(r)?.rateToInr ?? pending()),
    },
    {
      key: '_diff',
      label: 'vs default',
      align: 'right',
      render: (r) => {
        const live = rateOf(r);
        const saved = Number(r.exchangeRate);
        if (isBase(r) || !live || !(saved > 0)) return '';
        const pct = ((saved - Number(live.rateToInr)) / Number(live.rateToInr)) * 100;
        const text = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
        const tip = `Saved default ${saved} is ${Math.abs(pct).toFixed(2)}% ${pct >= 0 ? 'above' : 'below'} today's live rate`;
        return (
          <span title={tip} className={Math.abs(pct) >= 2 ? 'font-medium text-amber-700' : 'text-slate-500'}>
            {text}
          </span>
        );
      },
    },
    {
      key: '_source',
      label: 'Source',
      render: (r) => {
        const live = rateOf(r);
        if (!live) return '';
        const info = SOURCE_INFO[live.source];
        return (
          <span title={info.title}>
            <Badge tone={live.source === 'ECB' ? 'blue' : 'slate'}>{info.label}</Badge>
          </span>
        );
      },
    },
    {
      key: '_updated',
      label: 'Rate as of',
      render: (r) => {
        const live = rateOf(r);
        if (!live) return '';
        const days = daysOld(live.rateDate, now);
        return (
          <span title={`Published for ${formatDate(live.rateDate)} · last confirmed with the provider ${formatDateTime(live.fetchedAt)}`}>
            <span className={days > 4 ? 'font-medium text-amber-700' : 'text-slate-700'}>{formatDate(live.rateDate)}</span>
            <span className="text-slate-400"> · checked {timeAgo(live.fetchedAt, now)}</span>
          </span>
        );
      },
    },
  ];
}

/** Summary line above the Currencies grid: when rates were checked, refresh, and what to do if it failed. */
export function LiveRatesBar({ live, now }: { live: ReturnType<typeof useLiveRates>; now: number }) {
  const { query, refresh } = live;
  const data = query.data;
  const problem = data?.problem;
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-medium text-slate-800">Live rates in ₹ per unit</span>
        <span>
          {query.isPending
            ? 'Loading…'
            : data?.checkedAt
              ? <>Checked <span title={formatDateTime(data.checkedAt)}>{timeAgo(data.checkedAt, now)}</span> · re-checked every {data.refreshMinutes} min</>
              : 'Not checked yet'}
        </span>
        <span className="text-slate-400 max-sm:hidden">ECB reference rates; AED/SAR via ECB USD × open market data</span>
        <Button
          className="ml-auto !py-1"
          icon={<RefreshCw className="size-3.5" />}
          loading={refresh.isPending}
          onClick={() => refresh.mutate()}
          title="Ask the providers for the latest rates now"
        >
          Refresh
        </Button>
      </div>
      {query.error && !data && (
        <div className="mt-1.5">
          <ErrorBox error={query.error} />
        </div>
      )}
      {problem && (
        <div role="alert" className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-amber-800">
          <div className="font-medium">{problem.message}</div>
          <div className="text-amber-700">How to fix: {problem.hint}</div>
        </div>
      )}
      <div className="mt-1 text-[11.5px] text-slate-400">
        Reference rates for quoting and checks only. Shipping bills and customs valuation use the CBIC-notified exchange rate.
      </div>
    </div>
  );
}
