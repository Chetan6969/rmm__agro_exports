import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

/** Image upload for logos / letterheads / seals / signatures. Enter or Space opens the file picker. */
export function FileField({
  id,
  value,
  onChange,
  disabled,
  scope = 'group',
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  scope?: 'group' | 'company';
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.upload<{ id: string }>(`/files${scope === 'group' ? '?scope=group' : ''}`, f);
      onChange(res.id);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded border border-dashed border-slate-300 bg-slate-50">
          {value ? <img src={`/api/files/${value}`} alt="" className="max-h-full max-w-full object-contain" /> : <ImageUp className="size-5 text-slate-300" />}
        </div>
        <div className="flex flex-col gap-1">
          <button
            id={id}
            type="button"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[12.5px] hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? 'Uploading…' : value ? 'Replace…' : 'Upload…'}
          </button>
          {value && !disabled && (
            <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-red-600">
              <Trash2 className="size-3" /> Remove
            </button>
          )}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {err && <div className="mt-1 text-[12px] text-red-600">{err}</div>}
    </div>
  );
}
