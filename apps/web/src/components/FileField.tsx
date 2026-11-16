import { ImageUp, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ImageEditor, type ImageKind } from './ImageEditor';

/**
 * Branding image (logo, letterhead, footer, stamp/seal, signature).
 * Choosing a file opens the editor (background removal, crop, rotate) before upload;
 * "Edit" re-opens the current image in the editor. Enter or Space opens the file picker.
 */
export function FileField({
  id,
  value,
  onChange,
  disabled,
  kind = 'image',
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  kind?: ImageKind;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ url: string; name: string; file?: File } | null>(null);

  // free the object URL of a picked file when the editor closes
  useEffect(() => {
    const url = source?.file ? source.url : null;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [source]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setSource({ url: URL.createObjectURL(f), name: f.name, file: f });
    if (input.current) input.current.value = '';
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded border border-dashed border-slate-300 bg-[conic-gradient(#f1f5f9_25%,#fff_0_50%,#f1f5f9_0_75%,#fff_0)] bg-[length:12px_12px]">
          {value ? <img src={`/api/files/${value}`} alt="" className="max-h-full max-w-full object-contain" /> : <ImageUp className="size-5 text-slate-300" />}
        </div>
        <div className="flex flex-col items-start gap-1">
          <button
            id={id}
            type="button"
            data-nav="1"
            disabled={disabled}
            onClick={() => input.current?.click()}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[12.5px] hover:bg-slate-50 disabled:opacity-50"
          >
            {value ? 'Replace…' : 'Upload…'}
          </button>
          {value && !disabled && (
            <span className="flex gap-2">
              <button type="button" onClick={() => setSource({ url: `/api/files/${value}`, name: `${kind}.png` })} className="inline-flex items-center gap-1 text-[12px] text-slate-600 hover:text-brand-700">
                <Pencil className="size-3" /> Edit
              </button>
              <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-red-600">
                <Trash2 className="size-3" /> Remove
              </button>
            </span>
          )}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <ImageEditor open={!!source} source={source} kind={kind} onClose={() => setSource(null)} onSaved={(fid) => onChange(fid)} />
    </div>
  );
}
