import { Crop, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api } from '../lib/api';
import { baseCanvas, canvasToPng, cleanCanvas, loadImage, type BackgroundMode, type CleanOptions, type Rect } from '../lib/image-tools';
import { Modal } from './Modal';
import { Button, ErrorBox } from './ui';

export type ImageKind = 'logo' | 'signature' | 'seal' | 'letterhead' | 'footer' | 'image';

export const imageKindOf = (fieldName: string): ImageKind =>
  fieldName.startsWith('logo') ? 'logo' : fieldName.startsWith('signature') ? 'signature' : fieldName.startsWith('seal') ? 'seal' : fieldName.startsWith('letterhead') ? 'letterhead' : fieldName.startsWith('footer') ? 'footer' : 'image';

/** Sensible starting settings per image type; every setting stays adjustable. */
const PRESETS: Record<ImageKind, CleanOptions & { trim: boolean }> = {
  logo: { mode: 'edges', tolerance: 40, softness: 20, inkColor: null, trim: true },
  signature: { mode: 'all', tolerance: 70, softness: 35, inkColor: null, trim: true },
  seal: { mode: 'all', tolerance: 60, softness: 30, inkColor: null, trim: true },
  letterhead: { mode: 'none', tolerance: 40, softness: 20, inkColor: null, trim: false },
  footer: { mode: 'none', tolerance: 40, softness: 20, inkColor: null, trim: false },
  image: { mode: 'none', tolerance: 40, softness: 20, inkColor: null, trim: false },
};

const INKS = [
  { label: 'Original colours', value: null },
  { label: 'Black', value: '#111111' },
  { label: 'Dark blue', value: '#1d3a8a' },
  { label: 'Stamp blue', value: '#2848b8' },
  { label: 'Stamp red', value: '#b42318' },
  { label: 'Green', value: '#1f6f43' },
];

const BACKDROPS = {
  checker: 'bg-[conic-gradient(#e2e8f0_25%,#fff_0_50%,#e2e8f0_0_75%,#fff_0)] bg-[length:16px_16px]',
  white: 'bg-white',
  dark: 'bg-slate-800',
};

/**
 * Edit a branding image before it is saved: remove the background, recolour ink, rotate,
 * crop. The result is uploaded as a transparent PNG.
 */
export function ImageEditor({
  open,
  source,
  kind,
  onClose,
  onSaved,
}: {
  open: boolean;
  source: { url: string; name: string; file?: File } | null;
  kind: ImageKind;
  onClose: () => void;
  onSaved: (fileId: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [opts, setOpts] = useState<CleanOptions>(PRESETS[kind]);
  const [trim, setTrim] = useState(PRESETS[kind].trim);
  const [turns, setTurns] = useState(0);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [backdrop, setBackdrop] = useState<keyof typeof BACKDROPS>('checker');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const result = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!open || !source) return;
    const p = PRESETS[kind];
    setOpts(p);
    setTrim(p.trim);
    setTurns(0);
    setCrop(null);
    setCropping(false);
    setErr(null);
    setImg(null);
    loadImage(source.url).then(setImg, setErr);
  }, [open, source, kind]);

  // Re-render the result shortly after any setting changes.
  useEffect(() => {
    if (!img || !preview.current) return;
    const t = setTimeout(() => {
      const canvas = preview.current;
      if (!canvas) return;
      if (cropping) {
        const base = baseCanvas(img, turns, null);
        canvas.width = base.width;
        canvas.height = base.height;
        canvas.getContext('2d')!.drawImage(base, 0, 0);
        result.current = null;
        return;
      }
      const out = cleanCanvas(baseCanvas(img, turns, crop), opts, trim);
      result.current = out;
      canvas.width = out.width;
      canvas.height = out.height;
      canvas.getContext('2d')!.drawImage(out, 0, 0);
      setSize({ w: out.width, h: out.height });
    }, 80);
    return () => clearTimeout(t);
  }, [img, opts, trim, turns, crop, cropping]);

  /** Pointer position in the (rotated, full-size) image's coordinates. */
  const toImage = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const fullW = turns % 2 ? img!.height : img!.width;
    const k = fullW / r.width;
    return { x: Math.max(0, Math.min(fullW, (e.clientX - r.left) * k)), y: Math.max(0, (e.clientY - r.top) * k) };
  };
  const applyCrop = () => {
    if (drag) {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      const h = Math.abs(drag.y1 - drag.y0);
      if (w > 4 && h > 4) setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    }
    setDrag(null);
    setCropping(false);
  };

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.upload<{ id: string }>('/files?scope=group', file);
      onSaved(res.id);
      onClose();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!result.current || !source) return;
    await upload(await canvasToPng(result.current, source.name));
  };

  const set = <K extends keyof CleanOptions>(k: K, v: CleanOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const fullW = img ? (turns % 2 ? img.height : img.width) : 1;

  return (
    <Modal
      open={open}
      title={`Edit ${kind === 'seal' ? 'stamp / seal' : kind}`}
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          {source?.file && (
            <Button
              onClick={async () => {
                const f = source.file!;
                // PDFs can only embed PNG/JPEG. Keep the original look but re-encode WEBP (and
                // anything else) to PNG so it prints; PNG/JPEG upload exactly as chosen.
                if (f.type === 'image/png' || f.type === 'image/jpeg' || !img) return upload(f);
                try {
                  return await upload(await canvasToPng(baseCanvas(img, 0, null), f.name));
                } catch {
                  return upload(f);
                }
              }}
              disabled={busy}
              title="Upload as chosen, without background removal (converted to PNG so it prints)"
            >
              Upload original
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!img || cropping} data-nav-end>
            Save image
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_250px]">
        <div>
          <div className={`flex min-h-56 items-center justify-center overflow-hidden rounded border border-slate-200 p-3 ${BACKDROPS[backdrop]}`}>
            {!img && !err && <span className="text-[13px] text-slate-500">Opening image…</span>}
            <div className="relative max-w-full">
              <canvas
                ref={preview}
                className={`block max-h-[50vh] max-w-full ${cropping ? 'cursor-crosshair' : ''} ${img ? '' : 'hidden'}`}
                onPointerDown={(e) => {
                  if (!cropping) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const p = toImage(e);
                  setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                }}
                onPointerMove={(e) => {
                  if (!cropping || !drag || !e.buttons) return;
                  const p = toImage(e);
                  setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
                }}
              />
              {cropping && drag && preview.current && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-brand-600 bg-brand-500/10"
                  style={(() => {
                    const k = preview.current.clientWidth / fullW; // image px → screen px
                    return {
                      left: Math.min(drag.x0, drag.x1) * k,
                      top: Math.min(drag.y0, drag.y1) * k,
                      width: Math.abs(drag.x1 - drag.x0) * k,
                      height: Math.abs(drag.y1 - drag.y0) * k,
                    };
                  })()}
                />
              )}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
            <span>Preview on</span>
            {(Object.keys(BACKDROPS) as (keyof typeof BACKDROPS)[]).map((b) => (
              <button key={b} type="button" onClick={() => setBackdrop(b)} className={`rounded border px-2 py-0.5 capitalize ${backdrop === b ? 'border-slate-700 bg-slate-800 text-white' : 'border-slate-300 bg-white'}`}>
                {b === 'checker' ? 'transparent' : b}
              </button>
            ))}
            {size && !cropping && <span className="ml-auto tabular-nums">{size.w} × {size.h} px</span>}
          </div>
          {cropping && <div className="mt-2 text-[12.5px] text-slate-600">Drag over the part to keep, then press Apply crop.</div>}
          <ErrorBox error={err} />
        </div>

        <div className="space-y-3 text-[13px]">
          <fieldset>
            <legend className="mb-1 font-medium text-slate-700">Background</legend>
            {(
              [
                ['none', 'Keep background'],
                ['edges', 'Remove around the edges (logos)'],
                ['all', 'Remove all paper colour (signature, stamp)'],
              ] as [BackgroundMode, string][]
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2 py-0.5">
                <input type="radio" name="bg-mode" checked={opts.mode === v} onChange={() => set('mode', v)} className="accent-brand-700" />
                {label}
              </label>
            ))}
          </fieldset>
          {opts.mode !== 'none' && (
            <>
              <label className="block">
                <span className="flex justify-between text-slate-600">
                  Strength <span className="tabular-nums">{opts.tolerance}</span>
                </span>
                <input type="range" min={5} max={180} value={opts.tolerance} onChange={(e) => set('tolerance', Number(e.target.value))} className="w-full accent-brand-700" />
              </label>
              <label className="block">
                <span className="flex justify-between text-slate-600">
                  Edge smoothness <span className="tabular-nums">{opts.softness}</span>
                </span>
                <input type="range" min={0} max={100} value={opts.softness} onChange={(e) => set('softness', Number(e.target.value))} className="w-full accent-brand-700" />
              </label>
              <div className="text-[11.5px] text-slate-400">Raise the strength if paper shadows remain; lower it if parts of the ink disappear.</div>
            </>
          )}
          <label className="block">
            <span className="text-slate-600">Ink colour</span>
            <select className="field-input mt-0.5" value={opts.inkColor ?? ''} onChange={(e) => set('inkColor', e.target.value || null)}>
              {INKS.map((i) => (
                <option key={i.label} value={i.value ?? ''}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} className="accent-brand-700" />
            Trim empty margins
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Button icon={<RotateCcw className="size-3.5" />} onClick={() => setTurns((t) => t - 1)} title="Rotate left">
              Left
            </Button>
            <Button icon={<RotateCw className="size-3.5" />} onClick={() => setTurns((t) => t + 1)} title="Rotate right">
              Right
            </Button>
            {cropping ? (
              <Button variant="primary" icon={<Crop className="size-3.5" />} onClick={applyCrop}>
                Apply crop
              </Button>
            ) : (
              <Button
                icon={<Crop className="size-3.5" />}
                onClick={() => {
                  setCrop(null);
                  setCropping(true);
                }}
              >
                Crop
              </Button>
            )}
            <Button
              icon={<Undo2 className="size-3.5" />}
              onClick={() => {
                const p = PRESETS[kind];
                setOpts(p);
                setTrim(p.trim);
                setTurns(0);
                setCrop(null);
                setCropping(false);
              }}
            >
              Reset
            </Button>
          </div>
          <p className="text-[11.5px] text-slate-400">Saved as a transparent PNG, so it prints cleanly over the letterhead on every document.</p>
        </div>
      </div>
    </Modal>
  );
}
