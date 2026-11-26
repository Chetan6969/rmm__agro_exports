import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { errorHint, errorMessage } from '../lib/api';
import { keyLabel } from '../lib/hotkeys';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-slate-600 hover:bg-slate-200/60',
};

export function Button({
  variant = 'secondary',
  shortcut,
  loading,
  icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; shortcut?: string; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium whitespace-nowrap shadow-xs transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
      {shortcut && (
        <span className={`ml-1 text-[10.5px] max-sm:hidden ${variant === 'primary' || variant === 'danger' ? 'text-white/70' : 'text-slate-400'}`}>
          {keyLabel(shortcut)}
        </span>
      )}
    </button>
  );
}

export const Kbd = ({ k }: { k: string }) => (
  <span className="inline-flex gap-0.5">
    {k.split(' ').map((part) => (
      <kbd key={part} className="kbd">
        {keyLabel(part)}
      </kbd>
    ))}
  </span>
);

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    green: 'bg-brand-50 text-brand-700 ring-brand-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  };
  return <span className={`inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export const Spinner = ({ label = 'Loading…' }: { label?: string }) => (
  <div className="flex items-center gap-2 p-6 text-slate-500">
    <Loader2 className="size-4 animate-spin" /> {label}
  </div>
);

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-5">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="text-[12.5px] text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const hint = errorHint(error);
  return (
    <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
      <div className="font-medium">{errorMessage(error)}</div>
      {hint && <div className="mt-0.5 text-[12.5px] text-red-600/90">How to fix: {hint}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md border border-slate-200 bg-white shadow-xs ${className}`}>{children}</div>;
}
